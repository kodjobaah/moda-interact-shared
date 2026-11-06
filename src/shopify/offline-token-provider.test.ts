import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createShopifyOfflineTokenProvider,
  ShopifyOfflineTokenError,
  type ShopifyOfflineDatabase,
  type ShopifyOfflineSessionRecord,
  type ShopifyOfflineShopRecord,
  type ShopifyOfflineTransaction,
} from "./offline-token-provider.js";

const fixedNow = Date.parse("2026-11-06T12:00:00.000Z");
const baseSession = (): ShopifyOfflineSessionRecord => ({
  id: "session-real-id", shop: "store.example", isOnline: false, accessToken: "old-access",
  refreshToken: "old-refresh", scope: "read_products", expires: new Date(fixedNow - 1000),
  refreshTokenExpires: new Date(fixedNow + 86_400_000),
});
const shop: ShopifyOfflineShopRecord = { id: "shop-1", domain: "store.example", platform: "SHOPIFY", status: "ACTIVE" };

function fixture(options: Readonly<{
  rows?: ShopifyOfflineSessionRecord[];
  response?: () => Promise<Response>;
  update?: (data: Readonly<Record<string, unknown>>) => ShopifyOfflineSessionRecord;
  otherShop?: ShopifyOfflineShopRecord | null;
  rootShop?: ShopifyOfflineShopRecord | null;
  rootFailure?: boolean;
  lockFailure?: boolean;
  statementFailure?: boolean;
  readOAuth?: () => Promise<Readonly<{ apiKey: string; apiSecret: string }>>;
}> = {}) {
  let row = baseSession();
  const calls: { urls: string[]; lockSql: string[]; updates: Record<string, unknown>[]; stages: string[] } = { urls: [], lockSql: [], updates: [], stages: [] };
  let sessionRows = options.rows ?? [row];
  const session = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => { calls.stages.push("session.findUnique"); return sessionRows.find((item) => item.id === where.id) ?? null; },
    findMany: async () => { calls.stages.push("session.findMany"); return sessionRows; },
    create: async () => row,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      calls.stages.push("session.update");
      calls.updates.push(data);
      if (options.update) row = options.update(data);
      else row = { ...row, ...data } as ShopifyOfflineSessionRecord;
      sessionRows = [row];
      return row;
    },
    upsert: async () => row,
    delete: async () => row,
    deleteMany: async () => ({ count: 0 }),
    updateMany: async () => ({ count: 0 }),
  };
  const tx: ShopifyOfflineTransaction = {
    $executeRawUnsafe: async (sql) => { calls.stages.push("executeRaw"); calls.lockSql.push(sql); return 0; },
    $queryRawUnsafe: async (sql) => { calls.stages.push("queryRaw"); calls.lockSql.push(sql); if (options.lockFailure) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }); if (options.statementFailure) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }); return [] as never; },
    session,
    shop: { findUnique: async () => { calls.stages.push("transaction.shop.findUnique"); return options.otherShop === undefined ? shop : options.otherShop; } },
  };
  const prisma: ShopifyOfflineDatabase = {
    $transaction: async (work) => work(tx),
    shop: { findUnique: async () => { calls.stages.push("root.shop.findUnique"); if (options.rootFailure) throw new Error("database credential canary"); return options.rootShop === undefined ? shop : options.rootShop; } },
  };
  const fetcher: typeof fetch = async (url) => {
    calls.stages.push("fetch");
    calls.urls.push(String(url));
    if (options.response) return options.response();
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, refresh_token_expires_in: 86400 });
  };
  const provider = createShopifyOfflineTokenProvider({ prisma, readOAuth: options.readOAuth ?? (async () => ({ apiKey: "safe-api-key", apiSecret: "safe-api-secret" })), fetch: fetcher, now: () => fixedNow });
  return { provider, calls, getRow: () => row };
}

test("refreshes under the lifecycle and actual Session row locks, then returns only the committed snapshot", async () => {
  const f = fixture();
  let result;
  try { result = await f.provider.getSession("shop-1"); }
  catch { assert.fail(`safe provider test failed after: ${f.calls.stages.join(",")}`); }
  assert.equal(result.id, "session-real-id");
  assert.equal(result.accessToken, "new-access");
  assert.equal("refreshToken" in result, false);
  assert.equal(f.getRow().refreshToken, "new-refresh");
  assert.equal(f.calls.urls.length, 1);
  assert.equal(f.calls.urls[0], "https://store.example/admin/oauth/access_token");
  assert.ok(f.calls.lockSql.some((sql) => sql.includes("hashtextextended($1, 0)")));
  assert.ok(f.calls.lockSql.some((sql) => sql.includes('WHERE "id" = $1 FOR UPDATE')));
});

test("getAccessToken delegates to getSession and scope omission preserves the stored value", async () => {
  const f = fixture({ response: async () => Response.json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 3600, refresh_token_expires_in: 86400 }) });
  assert.equal(await f.provider.getAccessToken("shop-1"), "next-access");
  assert.equal(f.getRow().scope, "read_products");
  assert.equal(f.calls.updates.length, 1);
});

test("present scope replaces stored scope", async () => {
  const f = fixture({ response: async () => Response.json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 3600, refresh_token_expires_in: 86400, scope: "read_orders" }) });
  await f.provider.getSession("shop-1");
  assert.equal(f.getRow().scope, "read_orders");
});

test("unknown selected shop, foreign provider, inactive shop and ambiguous sessions fail before OAuth", async () => {
  for (const [value, code] of [
    [null, "SESSION_MISSING"],
    [{ ...shop, platform: "WOOCOMMERCE" }, "INVALID_SESSION"],
    [{ ...shop, status: "UNINSTALLED" }, "INVALID_SESSION"],
  ] as const) {
    const f = fixture({ otherShop: value });
    await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === code);
    assert.equal(f.calls.urls.length, 0);
  }
  const foreign = fixture({ rows: [{ ...baseSession(), shop: "foreign.example" }] });
  await assert.rejects(foreign.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "SESSION_IDENTITY_CONFLICT");
  assert.equal(foreign.calls.urls.length, 0);
  const duplicate = fixture({ rows: [baseSession(), { ...baseSession(), id: "second-id" }] });
  await assert.rejects(duplicate.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "SESSION_IDENTITY_CONFLICT");
  assert.equal(duplicate.calls.urls.length, 0);
});

test("expired refresh token and invalid refresh response make no unsafe persistence", async () => {
  const expired = fixture({ rows: [{ ...baseSession(), refreshTokenExpires: new Date(fixedNow - 1) }] });
  await assert.rejects(expired.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_TOKEN_EXPIRED");
  assert.equal(expired.calls.urls.length, 0);
  const invalid = fixture({ response: async () => Response.json({ access_token: "bad\nsecret", refresh_token: "new", expires_in: 3600, refresh_token_expires_in: 3600 }) });
  await assert.rejects(invalid.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_RESPONSE_INVALID");
  assert.equal(invalid.calls.updates.length, 0);
});

test("provider 4xx rejection is safe and does not expose provider response body", async () => {
  const canary = "provider-secret-response-body";
  const f = fixture({ response: async () => new Response(canary, { status: 401 }) });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_REJECTED" && !error.message.includes(canary));
  assert.equal(f.calls.updates.length, 0);
});

test("OAuth failures, missing shops, lock timeouts and pre-aborted callers map to bounded safe codes", async () => {
  const missing = fixture({ rootShop: null });
  await assert.rejects(missing.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "SESSION_MISSING");
  const database = fixture({ rootFailure: true });
  await assert.rejects(database.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "PERSISTENCE_UNAVAILABLE" && !error.message.includes("canary"));
  const lock = fixture({ lockFailure: true });
  await assert.rejects(lock.provider.withSessionLock("shop-1", async () => undefined), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "LOCK_TIMEOUT" && error.retryable);
  const statement = fixture({ statementFailure: true });
  await assert.rejects(statement.provider.withSessionLock("shop-1", async () => undefined), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "DEADLINE" && error.retryable);
  const oauth = fixture({ readOAuth: async () => { throw new Error("oauth-secret-canary"); } });
  await assert.rejects(oauth.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "OAUTH_CONFIG_UNAVAILABLE" && !error.message.includes("canary"));
  const cancelled = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cancelled.provider.withSessionLock("shop-1", async () => undefined, { signal: controller.signal }), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "CANCELLED");
});

test("a response exceeding the streamed body bound is rejected before persistence", async () => {
  const f = fixture({ response: async () => new Response(new Uint8Array(16_385)) });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_RESPONSE_INVALID");
  assert.equal(f.calls.updates.length, 0);
});

test("a fresh access token outside the 320 second refresh margin is returned without OAuth I/O", async () => {
  const f = fixture({ rows: [{ ...baseSession(), expires: new Date(fixedNow + 320_001) }] });
  const result = await f.provider.getSession("shop-1");
  assert.equal(result.accessToken, "old-access");
  assert.equal(f.calls.urls.length, 0);
});

test("legacy non-expiring offline access token is returned without a refresh request", async () => {
  const f = fixture({ rows: [{ ...baseSession(), expires: null, refreshToken: null, refreshTokenExpires: null }] });
  const result = await f.provider.getSession("shop-1");
  assert.equal(result.accessToken, "old-access");
  assert.equal(result.expires, null);
  assert.equal(f.calls.urls.length, 0);
});

test("session-lock callback failures pass through unchanged for the SDK composition boundary", async () => {
  const f = fixture();
  const failure = new Response("redirect", { status: 302, headers: { location: "/auth" } });
  await assert.rejects(f.provider.withSessionLock("shop-1", async () => { throw failure; }), (error: unknown) => error === failure);
});

test("the provider enforces the 15 second callback deadline", { timeout: 18_000 }, async () => {
  const f = fixture({ readOAuth: () => new Promise(() => undefined) });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "DEADLINE" && error.retryable);
});

test("persist failure after remote success becomes an unknown outcome without returning a token", async () => {
  const f = fixture({ update: () => { throw new Error("database and secret must not escape"); } });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_OUTCOME_UNKNOWN" && !error.message.includes("secret"));
});

