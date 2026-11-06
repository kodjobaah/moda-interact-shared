import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createShopifyOfflineTokenProvider, ShopifyOfflineTokenError } from "./offline-token-provider.js";

const prismaClientPath = process.env.ARCH061_PRISMA_CLIENT_PATH;
const databaseUrl = process.env.DATABASE_URL;
const canRun = Boolean(prismaClientPath && databaseUrl && process.env.ARCH061_DISPOSABLE_POSTGRES === "1");

test("two independent Prisma clients serialize refresh, bound waits, isolate shops and recover rolled-back saves", { skip: !canRun && "run scripts/test-arch061-shopify-token-postgres.mjs against disposable PostgreSQL" }, async () => {
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require(prismaClientPath!) as { PrismaClient: new (options: unknown) => any };
  const prismaOptions = { datasources: { db: { url: databaseUrl } } };
  const clientA = new PrismaClient(prismaOptions);
  const clientB = new PrismaClient(prismaOptions);
  const stages: string[] = [];
  const trackClient = (client: any) => new Proxy(client, { get(target, property, receiver) {
    if (property === "shop") {
      const delegate = Reflect.get(target, property, receiver);
      return new Proxy(delegate, { get(object, method, objectReceiver) {
        const operation = Reflect.get(object, method, objectReceiver);
        if (typeof operation !== "function") return operation;
        return (...args: unknown[]) => { stages.push(`root.shop.${String(method)}`); return operation.apply(object, args); };
      } });
    }
    if (property !== "$transaction") return Reflect.get(target, property, receiver);
    return (work: (tx: any) => Promise<unknown>, options: unknown) => target.$transaction((tx: any) => work(new Proxy(tx, {
      get(txTarget, txProperty, txReceiver) {
        const value = Reflect.get(txTarget, txProperty, txReceiver);
        if (txProperty === "session" || txProperty === "shop") return new Proxy(value, { get(delegate, method, delegateReceiver) {
          const operation = Reflect.get(delegate, method, delegateReceiver);
          if (typeof operation !== "function") return operation;
          return (...args: unknown[]) => { stages.push(`tx.${String(txProperty)}.${String(method)}`); return operation.apply(delegate, args); };
        } });
        if (typeof value === "function" && ["$executeRawUnsafe", "$queryRawUnsafe"].includes(String(txProperty))) return (...args: unknown[]) => { stages.push(`tx.${String(txProperty)}`); return value.apply(txTarget, args); };
        return value;
      },
    })), options);
  } });
  const trackedA = trackClient(clientA);
  const trackedB = trackClient(clientB);
  const suffix = randomUUID().replaceAll("-", "");
  const domainA = `refresh-${suffix}.myshopify.com`;
  const domainB = `progress-${suffix}.myshopify.com`;
  const shopAId = `arch061-a-${suffix}`;
  const shopBId = `arch061-b-${suffix}`;
  const expiry = new Date(Date.now() - 1000);
  const refreshExpiry = new Date(Date.now() + 86_400_000);
  const makeProvider = (prisma: any, fetcher: typeof fetch) => createShopifyOfflineTokenProvider({
    prisma, fetch: fetcher, now: Date.now,
    readOAuth: async () => ({ apiKey: "postgres-test-key", apiSecret: "postgres-test-secret" }),
  });
  const seed = async (client: any, id: string, domain: string) => {
    await client.$executeRawUnsafe('INSERT INTO commerce."Shop" ("id", "domain", "platform", "status") VALUES ($1, $2, \'SHOPIFY\', \'ACTIVE\')', id, domain);
    await client.$executeRawUnsafe('INSERT INTO shopify."Session" ("id", "shop", "state", "isOnline", "accessToken", "refreshToken", "scope", "expires", "refreshTokenExpires") VALUES ($1, $2, \'arch061-state\', FALSE, \'old-access\', \'old-refresh\', \'read_products\', $3, $4)', `offline-real-${id}`, domain, expiry, refreshExpiry);
  };
  let enteredRefresh!: () => void;
  const refreshEntered = new Promise<void>((resolve) => { enteredRefresh = resolve; });
  let releaseRefresh!: () => void;
  const refreshRelease = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let fetchCount = 0;
  const blockedRefresh: typeof fetch = async () => {
    fetchCount += 1;
    enteredRefresh();
    await refreshRelease;
    return Response.json({ access_token: "committed-access", refresh_token: "committed-refresh", expires_in: 3600, refresh_token_expires_in: 86400 });
  };
  try {
    await seed(clientA, shopAId, domainA);
    await seed(clientA, shopBId, domainB);
    const providerA = makeProvider(trackedA, blockedRefresh);
    const providerB = makeProvider(trackedB, blockedRefresh);
    let first!: Promise<any>;
    let second!: Promise<any>;
    try { first = providerA.getSession(shopAId); second = providerB.getSession(shopAId); }
    catch { assert.fail(`provider setup failed after safe stages: ${stages.join(",")}`); }
    try {
      await Promise.race([
        refreshEntered,
        Promise.all([first, second]).then(() => { throw new Error("provider completed without a remote refresh"); }),
      ]);
    } catch { assert.fail(`provider stopped before refresh at safe stages: ${stages.join(",")}`); }
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(fetchCount, 1, "the second client must wait before remote refresh");
    releaseRefresh();
    let resultA: any;
    let resultB: any;
    try { [resultA, resultB] = await Promise.all([first, second]); }
    catch { assert.fail(`provider failed after safe stages: ${stages.join(",")}`); }
    assert.equal(fetchCount, 1, "one normal refresh is shared by both requests");
    assert.equal(resultA.accessToken, "committed-access");
    assert.equal(resultB.accessToken, "committed-access");
    const persisted = (await clientA.$queryRawUnsafe('SELECT "accessToken", "refreshToken" FROM shopify."Session" WHERE "id" = $1', `offline-real-${shopAId}`))[0];
    assert.equal(persisted.accessToken, "committed-access");
    assert.equal(persisted.refreshToken, "committed-refresh");

    let releaseHolder!: () => void;
    let holderEntered!: () => void;
    const holderStarted = new Promise<void>((resolve) => { holderEntered = resolve; });
    const hold = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const locked = providerA.withSessionLock(shopAId, async () => { holderEntered(); await hold; return undefined; });
    await holderStarted;
    const startedAt = Date.now();
    await assert.rejects(providerB.withSessionLock(shopAId, async () => undefined), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "LOCK_TIMEOUT");
    assert.ok(Date.now() - startedAt <= 5250, "lock timeout must honor SET LOCAL lock_timeout");
    const otherShopStarted = Date.now();
    const otherShopProvider = makeProvider(clientB, async () => Response.json({ access_token: "other-shop-access", refresh_token: "other-shop-refresh", expires_in: 3600, refresh_token_expires_in: 86400 }));
    const otherShopResult = await otherShopProvider.getSession(shopBId);
    assert.equal(otherShopResult.accessToken, "other-shop-access");
    assert.ok(Date.now() - otherShopStarted < 5000, "a different integration domain must make progress independently");
    releaseHolder();
    await locked;

    let failSave = true;
    const rollbackClient = new Proxy(clientA, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return (work: (tx: any) => Promise<unknown>, options: unknown) => target.$transaction((tx: any) => work(new Proxy(tx, {
          get(txTarget, txProperty, txReceiver) {
            if (txProperty !== "session") return Reflect.get(txTarget, txProperty, txReceiver);
            const session = Reflect.get(txTarget, txProperty, txReceiver);
            return new Proxy(session, { get(sessionTarget, method, sessionReceiver) {
              if (method !== "update" || !failSave) return Reflect.get(sessionTarget, method, sessionReceiver);
              return async () => { failSave = false; throw new Error("injected save failure"); };
            } });
          },
        })), options);
      },
    });
    await clientA.$executeRawUnsafe('UPDATE shopify."Session" SET "accessToken" = \'old-access\', "refreshToken" = \'old-refresh\', "expires" = $1, "refreshTokenExpires" = $2 WHERE "id" = $3', expiry, refreshExpiry, `offline-real-${shopBId}`);
    const recoveryFetches: string[] = [];
    const recoveryFetch: typeof fetch = async (_url, init) => {
      const body = String(init?.body ?? "");
      recoveryFetches.push(body);
      const access = recoveryFetches.length === 1 ? "must-rollback" : "recovered-access";
      const refresh = recoveryFetches.length === 1 ? "must-rollback-refresh" : "recovered-refresh";
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, refresh_token_expires_in: 86400 });
    };
    await assert.rejects(makeProvider(rollbackClient, recoveryFetch).getSession(shopBId), (error: unknown) => error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_OUTCOME_UNKNOWN");
    const afterRollback = (await clientA.$queryRawUnsafe('SELECT "accessToken", "refreshToken" FROM shopify."Session" WHERE "id" = $1', `offline-real-${shopBId}`))[0];
    assert.equal(afterRollback.accessToken, "old-access");
    assert.equal(afterRollback.refreshToken, "old-refresh");
    const recovered = await makeProvider(clientB, recoveryFetch).getSession(shopBId);
    assert.equal(recovered.accessToken, "recovered-access");
    const afterRecovery = (await clientA.$queryRawUnsafe('SELECT "accessToken", "refreshToken" FROM shopify."Session" WHERE "id" = $1', `offline-real-${shopBId}`))[0];
    assert.equal(afterRecovery.accessToken, "recovered-access");
    assert.equal(afterRecovery.refreshToken, "recovered-refresh");
    assert.equal(recoveryFetches.length, 2);
    assert.ok(recoveryFetches.every((body) => body.includes("old-refresh")), "the next request rereads and uses the durable pre-failure refresh token");
  } finally {
    await clientA.$executeRawUnsafe('DELETE FROM shopify."Session" WHERE "shop" IN ($1, $2)', domainA, domainB).catch(() => undefined);
    await clientA.$executeRawUnsafe('DELETE FROM commerce."Shop" WHERE "id" IN ($1, $2)', shopAId, shopBId).catch(() => undefined);
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
  }
});
