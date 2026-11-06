import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createShopifyOfflineTokenProvider,
  ShopifyOfflineTokenError,
  type ShopifyOfflineDatabase,
  type ShopifyOfflineRefreshEvent,
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
  onEvent?: (event: ShopifyOfflineRefreshEvent) => void;
  commitFailure?: boolean;
  response?: (signal?: AbortSignal | null) => Promise<Response>;
  update?: (data: Readonly<Record<string, unknown>>) => ShopifyOfflineSessionRecord;
  otherShop?: ShopifyOfflineShopRecord | null;
  rootShop?: ShopifyOfflineShopRecord | null;
  rootFailure?: boolean;
  rootLookup?: () => Promise<ShopifyOfflineShopRecord | null>;
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
    $transaction: async (work) => { const result = await work(tx); calls.stages.push("commit"); if (options.commitFailure) throw new Error("commit-secret-canary"); return result; },
    shop: { findUnique: async () => { calls.stages.push("root.shop.findUnique"); if (options.rootFailure) throw new Error("database credential canary"); if (options.rootLookup) return options.rootLookup(); return options.rootShop === undefined ? shop : options.rootShop; } },
  };
  const fetcher: typeof fetch = async (url, init) => {
    calls.stages.push("fetch");
    calls.urls.push(String(url));
    if (options.response) return options.response(init?.signal);
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, refresh_token_expires_in: 86400 });
  };
  const provider = createShopifyOfflineTokenProvider({ prisma, readOAuth: options.readOAuth ?? (async () => ({ apiKey: "safe-api-key", apiSecret: "safe-api-secret" })), fetch: fetcher, now: () => fixedNow, onEvent: options.onEvent });
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

test("expired refresh token makes no provider call; malformed successful response is an unknown outcome", async () => {
  const expired = fixture({ rows: [{ ...baseSession(), refreshTokenExpires: new Date(fixedNow - 1) }] });
  await assert.rejects(expired.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_TOKEN_EXPIRED");
  assert.equal(expired.calls.urls.length, 0);
  const invalidResponses = [
    async () => new Response("{ malformed json"),
    async () => Response.json({ access_token: "bad\nsecret", refresh_token: "new", expires_in: 3600, refresh_token_expires_in: 3600 }),
    async () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 30, refresh_token_expires_in: 3600 }),
    async () => new Response(new Uint8Array(16_385)),
  ];
  for (const response of invalidResponses) {
    const invalid = fixture({ response });
    await assert.rejects(invalid.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_OUTCOME_UNKNOWN" && error.retryable);
    assert.equal(invalid.calls.updates.length, 0);
    assert.equal(invalid.getRow().accessToken, "old-access");
    assert.equal(invalid.getRow().refreshToken, "old-refresh");
  }
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

test("the selected-shop lookup uses the same 15 second deadline before opening a transaction", { timeout: 18_000 }, async () => {
  const f = fixture({ rootLookup: () => new Promise(() => undefined) });
  const started = Date.now();
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "DEADLINE" && error.retryable);
  assert.ok(Date.now() - started < 16_000);
  assert.deepEqual(f.calls.stages, ["root.shop.findUnique"]);
});

test("an already-aborted caller does not perform the selected-shop lookup", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.provider.getSession("shop-1", { signal: controller.signal }), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "CANCELLED");
  await assert.rejects(f.provider.withSessionLock("shop-1", async () => undefined, { signal: controller.signal }), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "CANCELLED");
  assert.deepEqual(f.calls.stages, []);
});

test("persist failure after remote success becomes an unknown outcome without returning a token", async () => {
  const f = fixture({ update: () => { throw new Error("database and secret must not escape"); } });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_OUTCOME_UNKNOWN" && !error.message.includes("secret"));
});


test("refresh events are bounded, frozen, correlated and emitted only after commit", async () => {
  const events: ShopifyOfflineRefreshEvent[] = [];
  const observations: { urls: number; stage: string | undefined }[] = [];
  const f = fixture({ onEvent: (event) => {
    events.push(event);
    observations.push({ urls: f.calls.urls.length, stage: f.calls.stages.at(-1) });
  } });
  await f.provider.getSession("shop-1");
  assert.deepEqual(events.map((e) => e.event), ["shopify.offline_refresh.started", "shopify.offline_refresh.committed"]);
  assert.equal(observations[0]!.urls, 0);
  assert.equal(observations[1]!.stage, "commit");
  assert.equal(events[0]!.operationId, events[1]!.operationId);
  for (const event of events) {
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.getPrototypeOf(event), Object.prototype);
    assert.deepEqual(Object.keys(event).sort(), ["event", "operationId", "shopId", "source", "durationMs", "outcome", "reasonCode"].sort());
    assert.match(event.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(event.shopId, "shop-1"); assert.equal(event.source, "SHARED");
    assert.equal(event.reasonCode, null);
    assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0 && event.durationMs <= 60_000);
  }
  assert.doesNotMatch(JSON.stringify(events), /old-access|new-access|old-refresh|new-refresh|safe-api|store.example|session-real-id|read_products/);
  await f.provider.getSession("shop-1");
  assert.equal(events.length, 2, "reuse emits nothing");
  const next: ShopifyOfflineRefreshEvent[] = [];
  await fixture({ onEvent: (e) => { next.push(e); } }).provider.getSession("shop-1");
  assert.notEqual(next[0]!.operationId, events[0]!.operationId);
});

test("valid, nonexpiring and ineligible sessions emit no refresh events", async () => {
  for (const rows of [
    [{ ...baseSession(), expires: new Date(fixedNow + 320_001) }],
    [{ ...baseSession(), expires: null, refreshToken: null, refreshTokenExpires: null }],
    [{ ...baseSession(), refreshTokenExpires: new Date(fixedNow - 1) }],
  ]) {
    const events: ShopifyOfflineRefreshEvent[] = [];
    const f = fixture({ rows, onEvent: (event) => { events.push(event); } });
    await f.provider.getSession("shop-1").catch(() => undefined);
    assert.deepEqual(events, []);
  }
});

test("refresh failure events expose only terminal categories and never commit after save/commit failure", async () => {
  const cases = [
    { options: { response: async () => new Response("provider-body-secret-canary", { status: 401 }) }, reason: "REFRESH_REJECTED", outcome: "REJECTED" },
    { options: { response: async () => new Response("malformed-secret-canary") }, reason: "REFRESH_OUTCOME_UNKNOWN", outcome: "UNKNOWN" },
    { options: { response: async () => { throw new Error("network-secret-canary"); } }, reason: "REFRESH_OUTCOME_UNKNOWN", outcome: "UNKNOWN" },
    { options: { update: () => { throw new Error("persistence-secret-canary"); } }, reason: "REFRESH_OUTCOME_UNKNOWN", outcome: "UNKNOWN" },
    { options: { commitFailure: true }, reason: "REFRESH_OUTCOME_UNKNOWN", outcome: "UNKNOWN" },
  ] as const;
  for (const item of cases) {
    const events: ShopifyOfflineRefreshEvent[] = [];
    const f = fixture({ ...item.options, onEvent: (e) => { events.push(e); } });
    await assert.rejects(f.provider.getSession("shop-1"));
    assert.deepEqual(events.map((e) => e.event), ["shopify.offline_refresh.started", "shopify.offline_refresh.failed"]);
    assert.equal(events[1]!.reasonCode, item.reason);
    assert.equal(events[1]!.outcome, item.outcome);
    assert.doesNotMatch(JSON.stringify(events), /canary|old-refresh|new-refresh|store.example/);
  }
});

test("throwing and asynchronously rejecting hooks cannot fail successful or rejected refresh", async () => {
  for (const onEvent of [() => { throw new Error("hook-secret-canary"); }, async () => { throw new Error("hook-secret-canary"); }]) {
    assert.equal((await fixture({ onEvent }).provider.getSession("shop-1")).accessToken, "new-access");
    await assert.rejects(fixture({ onEvent, response: async () => new Response("", { status: 401 }) }).provider.getSession("shop-1"),
      (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_REJECTED");
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test("cancellation after dispatch emits exactly one cancelled terminal event", async () => {
  const controller = new AbortController();
  const events: ShopifyOfflineRefreshEvent[] = [];
  const f = fixture({ onEvent: (e) => { events.push(e); }, response: async () => { controller.abort(); throw new Error("cancel-secret-canary"); } });
  await assert.rejects(f.provider.getSession("shop-1", { signal: controller.signal }));
  assert.deepEqual(events.map((e) => e.outcome), ["STARTED", "CANCELLED"]);
  assert.equal(events[1]!.reasonCode, "CANCELLED");
});

test("network timeout emits one unknown terminal event without a committed event", { timeout: 10_000 }, async () => {
  const events: ShopifyOfflineRefreshEvent[] = [];
  const f = fixture({ onEvent: (event) => { events.push(event); }, response: (signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new Error("network-timeout-secret-canary")), { once: true });
  }) });
  await assert.rejects(f.provider.getSession("shop-1"), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_OUTCOME_UNKNOWN");
  assert.deepEqual(events.map((e) => e.outcome), ["STARTED", "UNKNOWN"]);
  assert.equal(events[1]!.reasonCode, "REFRESH_OUTCOME_UNKNOWN");
  assert.doesNotMatch(JSON.stringify(events), /canary/);
});
