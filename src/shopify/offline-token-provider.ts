import { Buffer } from "node:buffer";

export type ShopifyOfflineTokenErrorCode =
  | "SESSION_MISSING" | "SESSION_IDENTITY_CONFLICT" | "INVALID_SESSION"
  | "REFRESH_TOKEN_EXPIRED" | "OAUTH_CONFIG_UNAVAILABLE" | "LOCK_TIMEOUT"
  | "CANCELLED" | "DEADLINE" | "REFRESH_REJECTED"
  | "REFRESH_RESPONSE_INVALID" | "REFRESH_OUTCOME_UNKNOWN" | "PERSISTENCE_UNAVAILABLE";

const ERROR_MESSAGES: Record<ShopifyOfflineTokenErrorCode, string> = {
  SESSION_MISSING: "Shopify offline session is unavailable.",
  SESSION_IDENTITY_CONFLICT: "Shopify offline session identity is inconsistent.",
  INVALID_SESSION: "Shopify offline session is invalid.",
  REFRESH_TOKEN_EXPIRED: "Shopify offline refresh token has expired.",
  OAUTH_CONFIG_UNAVAILABLE: "Shopify OAuth configuration is unavailable.",
  LOCK_TIMEOUT: "Shopify offline session is busy; retry the request.",
  CANCELLED: "Shopify offline session request was cancelled.",
  DEADLINE: "Shopify offline session operation exceeded its time limit.",
  REFRESH_REJECTED: "Shopify rejected the offline refresh request.",
  REFRESH_RESPONSE_INVALID: "Shopify returned an invalid offline refresh response.",
  REFRESH_OUTCOME_UNKNOWN: "Shopify refresh outcome is unknown; retry in a later request.",
  PERSISTENCE_UNAVAILABLE: "Shopify offline session could not be persisted.",
};

const RETRYABLE = new Set<ShopifyOfflineTokenErrorCode>([
  "LOCK_TIMEOUT", "DEADLINE", "PERSISTENCE_UNAVAILABLE", "REFRESH_OUTCOME_UNKNOWN",
]);

export class ShopifyOfflineTokenError extends Error {
  readonly code: ShopifyOfflineTokenErrorCode;
  readonly retryable: boolean;

  constructor(code: ShopifyOfflineTokenErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ShopifyOfflineTokenError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

class CallbackFailure extends Error {
  constructor(readonly value: unknown) { super("Shopify offline callback failed."); }
}

export type ShopifyOfflineSessionRecord = Readonly<{
  id: string; shop: string; isOnline: boolean; accessToken: string | null; refreshToken: string | null;
  scope: string | null; expires: Date | null; refreshTokenExpires: Date | null;
}>;
export type ShopifyOfflineShopRecord = Readonly<{
  id: string; domain: string; platform: string; status: string;
}>;

export type ShopifyOfflineStringFilter = string | Readonly<{
  equals?: string; in?: string[]; notIn?: string[]; lt?: string; lte?: string; gt?: string; gte?: string;
  contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive";
  not?: string | ShopifyOfflineStringFilter;
}>;
export type ShopifyOfflineBooleanFilter = boolean | Readonly<{ equals?: boolean; not?: boolean | ShopifyOfflineBooleanFilter }>;
export type ShopifyOfflineNullableStringFilter = string | null | Readonly<{
  equals?: string | null; in?: string[] | null; notIn?: string[] | null; lt?: string; lte?: string; gt?: string; gte?: string;
  contains?: string; startsWith?: string; endsWith?: string; mode?: "default" | "insensitive";
  not?: string | null | ShopifyOfflineNullableStringFilter;
}>;
export type ShopifyOfflineNullableBooleanFilter = boolean | null | Readonly<{
  equals?: boolean | null; not?: boolean | null | ShopifyOfflineNullableBooleanFilter;
}>;
export type ShopifyOfflineDateFilter = Date | string | null | Readonly<{
  equals?: Date | string | null; in?: Date[] | string[] | null; notIn?: Date[] | string[] | null;
  lt?: Date | string; lte?: Date | string; gt?: Date | string; gte?: Date | string;
  not?: Date | string | null | ShopifyOfflineDateFilter;
}>;
export type ShopifyOfflineBigIntFilter = bigint | number | null | Readonly<{
  equals?: bigint | number | null; in?: bigint[] | number[] | null; notIn?: bigint[] | number[] | null;
  lt?: bigint | number; lte?: bigint | number; gt?: bigint | number; gte?: bigint | number;
  not?: bigint | number | null | ShopifyOfflineBigIntFilter;
}>;
export type ShopifyOfflineSessionScalarWhere = {
  id?: ShopifyOfflineStringFilter;
  shop?: ShopifyOfflineStringFilter;
  state?: ShopifyOfflineStringFilter;
  isOnline?: ShopifyOfflineBooleanFilter;
  scope?: ShopifyOfflineNullableStringFilter;
  expires?: ShopifyOfflineDateFilter;
  accessToken?: ShopifyOfflineStringFilter;
  userId?: ShopifyOfflineBigIntFilter;
  firstName?: ShopifyOfflineNullableStringFilter;
  lastName?: ShopifyOfflineNullableStringFilter;
  email?: ShopifyOfflineNullableStringFilter;
  accountOwner?: ShopifyOfflineBooleanFilter;
  locale?: ShopifyOfflineNullableStringFilter;
  collaborator?: ShopifyOfflineNullableBooleanFilter;
  emailVerified?: ShopifyOfflineNullableBooleanFilter;
  refreshToken?: ShopifyOfflineNullableStringFilter;
  refreshTokenExpires?: ShopifyOfflineDateFilter;
};
export type ShopifyOfflineSessionWhere = ShopifyOfflineSessionScalarWhere & {
  AND?: ShopifyOfflineSessionScalarWhere | ShopifyOfflineSessionScalarWhere[];
  OR?: ShopifyOfflineSessionScalarWhere[];
  NOT?: ShopifyOfflineSessionScalarWhere | ShopifyOfflineSessionScalarWhere[];
};
export type ShopifyOfflineSessionUniqueWhere = Readonly<{ id: string }>;
export type ShopifyOfflineSessionSelect = Readonly<Partial<Record<
  "id" | "shop" | "state" | "isOnline" | "scope" | "expires" | "accessToken" | "userId"
  | "firstName" | "lastName" | "email" | "accountOwner" | "locale" | "collaborator"
  | "emailVerified" | "refreshToken" | "refreshTokenExpires",
  true
>>>;
export type ShopifyOfflineSessionData = Readonly<{
  id?: string;
  shop?: string;
  state?: string;
  isOnline?: boolean;
  scope?: string | null;
  expires?: Date | null;
  accessToken?: string;
  userId?: bigint | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  accountOwner?: boolean;
  locale?: string | null;
  collaborator?: boolean | null;
  emailVerified?: boolean | null;
  refreshToken?: string | null;
  refreshTokenExpires?: Date | null;
}>;
export type ShopifyOfflineSessionCreateData = ShopifyOfflineSessionData & Readonly<{
  id: string;
  shop: string;
  state: string;
  accessToken: string;
}>;
export type ShopifyOfflineSessionDelegate = Readonly<{
  findUnique(args: Readonly<{ where: ShopifyOfflineSessionUniqueWhere; select?: ShopifyOfflineSessionSelect }>): Promise<ShopifyOfflineSessionRecord | null>;
  findMany(args: Readonly<{ where: ShopifyOfflineSessionWhere; select?: ShopifyOfflineSessionSelect; take?: number }>): Promise<ShopifyOfflineSessionRecord[]>;
  create(args: Readonly<{ data: ShopifyOfflineSessionCreateData; select?: ShopifyOfflineSessionSelect }>): Promise<ShopifyOfflineSessionRecord>;
  update(args: Readonly<{ where: ShopifyOfflineSessionUniqueWhere; data: ShopifyOfflineSessionData; select?: ShopifyOfflineSessionSelect }>): Promise<ShopifyOfflineSessionRecord>;
  upsert(args: Readonly<{ where: ShopifyOfflineSessionUniqueWhere; create: ShopifyOfflineSessionCreateData; update: ShopifyOfflineSessionData; select?: ShopifyOfflineSessionSelect }>): Promise<ShopifyOfflineSessionRecord>;
  delete(args: Readonly<{ where: ShopifyOfflineSessionUniqueWhere; select?: ShopifyOfflineSessionSelect }>): Promise<ShopifyOfflineSessionRecord>;
  deleteMany(args: Readonly<{ where?: ShopifyOfflineSessionWhere }>): Promise<{ count: number }>;
  updateMany(args: Readonly<{ where?: ShopifyOfflineSessionWhere; data: ShopifyOfflineSessionData }>): Promise<{ count: number }>;
}>;

export type ShopifyOfflineTransaction = Readonly<{
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  session: ShopifyOfflineSessionDelegate;
  shop: Readonly<{
    findUnique(args: Readonly<{ where: Readonly<{ id: string }>; select: Readonly<{ id: true; domain: true; platform: true; status: true }> }>): Promise<ShopifyOfflineShopRecord | null>;
  }>;
}>;

export type ShopifyOfflineDatabase = Readonly<{
  $transaction<T>(
    work: (transaction: ShopifyOfflineTransaction) => Promise<T>,
    options: Readonly<{ maxWait: 5000; timeout: 20000; isolationLevel: "ReadCommitted" }>,
  ): Promise<T>;
  shop: ShopifyOfflineTransaction["shop"];
}>;

export type OfflineCredentialSnapshot = Readonly<{
  id: string; shopId: string; shop: string; accessToken: string; scope: string | null;
  expires: Date | null; refreshTokenExpires: Date | null;
}>;
export type LockedSessionContext = Readonly<{
  transaction: ShopifyOfflineTransaction; shopId: string; shop: string; sessionId: string; signal: AbortSignal;
}>;
export type SdkInstallationSessionContext = Readonly<{
  transaction: ShopifyOfflineTransaction; shopId: null; shop: string; sessionId: string | null; signal: AbortSignal;
}>;
export type ShopifyOfflineTokenProvider = Readonly<{
  withSdkInstallationSessionLock<T>(integrationDomain: string, work: (context: SdkInstallationSessionContext) => Promise<T>): Promise<T>;
  getAccessToken(shopId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<string>;
  getSession(shopId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<OfflineCredentialSnapshot>;
  withSessionLock<T>(shopId: string, work: (context: LockedSessionContext) => Promise<T>, options?: Readonly<{ signal?: AbortSignal }>): Promise<T>;
}>;

type PersistedShop = ShopifyOfflineShopRecord;
const TX_OPTIONS = { maxWait: 5000, timeout: 20000, isolationLevel: "ReadCommitted" } as const;
const ACCESS_REFRESH_SKEW_MS = 320_000;
const REFRESH_NETWORK_BUDGET_MS = 8_000;
const OPERATION_BUDGET_MS = 15_000;
const RESPONSE_LIMIT = 16_384;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SESSION_SELECT = { id: true, shop: true, isOnline: true, accessToken: true, refreshToken: true, scope: true, expires: true, refreshTokenExpires: true } as const;

function fail(code: ShopifyOfflineTokenErrorCode): never { throw new ShopifyOfflineTokenError(code); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim() === value && !/[\r\n\u0000]/.test(value);
}
function validScope(value: unknown): value is string { return typeof value === "string" && value.length <= 4096 && !CONTROL.test(value); }
function validDate(value: unknown): value is Date | null { return value === null || (value instanceof Date && Number.isFinite(value.getTime())); }
function mapDatabaseError(error: unknown): ShopifyOfflineTokenError {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "55P03" || /lock timeout/i.test(message)) return new ShopifyOfflineTokenError("LOCK_TIMEOUT");
  if (code === "57014" || /statement timeout|statement timed out/i.test(message)) return new ShopifyOfflineTokenError("DEADLINE");
  return new ShopifyOfflineTokenError("PERSISTENCE_UNAVAILABLE");
}

function createDeadline(signal?: AbortSignal): Readonly<{ signal: AbortSignal; dispose(): void; check(): void; wait<T>(work: Promise<T>): Promise<T> }> {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, OPERATION_BUDGET_MS);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
    wait<T>(work: Promise<T>): Promise<T> {
      if (controller.signal.aborted) this.check();
      let onDeadline: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onDeadline = () => reject(new Error("operation aborted"));
        controller.signal.addEventListener("abort", onDeadline, { once: true });
      });
      return Promise.race([work, aborted]).finally(() => {
        if (onDeadline) controller.signal.removeEventListener("abort", onDeadline);
      });
    },
    check() {
      if (signal?.aborted) fail("CANCELLED");
      if (expired) fail("DEADLINE");
      if (controller.signal.aborted) fail("DEADLINE");
    },
  };
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("refresh stream aborted");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) {
        await reader.cancel().catch(() => undefined);
        fail("REFRESH_RESPONSE_INVALID");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function snapshot(row: ShopifyOfflineSessionRecord, shopId: string, shop: string): OfflineCredentialSnapshot {
  if (!validToken(row.accessToken) || !validScope(row.scope) && row.scope !== null
    || !validDate(row.expires) || !validDate(row.refreshTokenExpires)) fail("INVALID_SESSION");
  return Object.freeze({ id: row.id, shopId, shop, accessToken: row.accessToken, scope: row.scope, expires: row.expires, refreshTokenExpires: row.refreshTokenExpires });
}

export function createShopifyOfflineTokenProvider(input: Readonly<{
  prisma: ShopifyOfflineDatabase;
  readOAuth: () => Promise<Readonly<{ apiKey: string; apiSecret: string }>>;
  fetch: typeof fetch;
  now?: () => number;
}>): ShopifyOfflineTokenProvider {
  const now = input.now ?? Date.now;

  async function resolveShop(shopId: string): Promise<PersistedShop> {
    if (typeof shopId !== "string" || !shopId.trim()) fail("SESSION_MISSING");
    let shop: PersistedShop | null;
    try { shop = await input.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, domain: true, platform: true, status: true } }); }
    catch { fail("PERSISTENCE_UNAVAILABLE"); }
    if (!shop) fail("SESSION_MISSING");
    if (shop.platform !== "SHOPIFY" || shop.status !== "ACTIVE") fail("INVALID_SESSION");
    if (!shop.domain) fail("SESSION_IDENTITY_CONFLICT");
    return shop;
  }

  async function runLocked<T>(shop: PersistedShop, shopId: string, signal: AbortSignal | undefined, work: (context: LockedSessionContext) => Promise<T>, outcome: { remoteSucceeded: boolean } = { remoteSucceeded: false }): Promise<T> {
    const deadline = createDeadline(signal);
    try {
      deadline.check();
      const result = await input.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '18s'");
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL", `moda:shopify-offline:v1:${shop.domain}`);
        deadline.check();

        const currentShop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true, domain: true, platform: true, status: true } });
        if (!currentShop) fail("SESSION_MISSING");
        if (currentShop.platform !== "SHOPIFY" || currentShop.status !== "ACTIVE") fail("INVALID_SESSION");
        if (currentShop.domain !== shop.domain) fail("SESSION_IDENTITY_CONFLICT");

        const sessions = await tx.session.findMany({ where: { shop: currentShop.domain, isOnline: false }, select: SESSION_SELECT, take: 2 });
        if (sessions.length === 0) fail("SESSION_MISSING");
        if (sessions.length !== 1) fail("SESSION_IDENTITY_CONFLICT");
        const row = sessions[0]!;
        if (!row.id || row.shop !== currentShop.domain || row.isOnline !== false) fail("SESSION_IDENTITY_CONFLICT");
        await tx.$queryRawUnsafe('SELECT "id" FROM "shopify"."Session" WHERE "id" = $1 FOR UPDATE', row.id);
        const reread = await tx.session.findUnique({ where: { id: row.id }, select: SESSION_SELECT });
        if (!reread || reread.id !== row.id || reread.shop !== currentShop.domain || reread.isOnline !== false) fail("SESSION_IDENTITY_CONFLICT");

        const context: LockedSessionContext = Object.freeze({ transaction: tx, shopId, shop: currentShop.domain, sessionId: reread.id, signal: deadline.signal });
        deadline.check();
        let value: T;
        try { value = await deadline.wait(work(context)); }
        catch (error) { deadline.check(); throw new CallbackFailure(error); }
        deadline.check();
        return value;
      }, TX_OPTIONS);
      return result;
    } catch (error) {
      if (error instanceof CallbackFailure) throw error.value;
      if (signal?.aborted) fail("CANCELLED");
      if (outcome.remoteSucceeded && (error instanceof ShopifyOfflineTokenError
        ? error.code === "LOCK_TIMEOUT" || error.code === "DEADLINE" || error.code === "PERSISTENCE_UNAVAILABLE"
        : true)) fail("REFRESH_OUTCOME_UNKNOWN");
      if (error instanceof ShopifyOfflineTokenError) throw error;
      deadline.check();
      throw mapDatabaseError(error);
    } finally { deadline.dispose(); }
  }

  async function getSession(shopId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<OfflineCredentialSnapshot> {
    const shop = await resolveShop(shopId);
    const outcome = { remoteSucceeded: false };
    return runLocked(shop, shopId, options?.signal, async (context) => {
      let row = await context.transaction.session.findUnique({ where: { id: context.sessionId }, select: SESSION_SELECT });
      if (!row) fail("SESSION_IDENTITY_CONFLICT");
      const currentTime = now();
      if (!Number.isFinite(currentTime)) fail("INVALID_SESSION");
      if (row.expires === null && row.refreshToken === null) return snapshot(row, shopId, context.shop);
      if (row.expires === null) fail("INVALID_SESSION");
      const expiresAt = row.expires?.getTime() ?? 0;
      if (expiresAt - currentTime > ACCESS_REFRESH_SKEW_MS) return snapshot(row, shopId, context.shop);
      if (!validToken(row.refreshToken)) fail("INVALID_SESSION");
      if (!validDate(row.refreshTokenExpires) || row.refreshTokenExpires === null) fail("INVALID_SESSION");
      if (row.refreshTokenExpires.getTime() <= currentTime) fail("REFRESH_TOKEN_EXPIRED");

      let credentials: Readonly<{ apiKey: string; apiSecret: string }>;
      try { credentials = await input.readOAuth(); }
      catch { fail("OAUTH_CONFIG_UNAVAILABLE"); }
      if (options?.signal?.aborted) fail("CANCELLED");
      if (context.signal.aborted) fail("DEADLINE");
      if (!validToken(credentials.apiKey) || !validToken(credentials.apiSecret)) fail("OAUTH_CONFIG_UNAVAILABLE");
      const requestStartedAt = now();
      const refreshController = new AbortController();
      const refreshTimeout = setTimeout(() => refreshController.abort(), REFRESH_NETWORK_BUDGET_MS);
      const onAbort = () => refreshController.abort();
      context.signal.addEventListener("abort", onAbort, { once: true });
      let response: Response;
      try {
        const form = new URLSearchParams({ client_id: credentials.apiKey, client_secret: credentials.apiSecret, grant_type: "refresh_token", refresh_token: row.refreshToken });
        response = await input.fetch(`https://${context.shop}/admin/oauth/access_token`, {
          method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: refreshController.signal,
        });
      } catch {
        clearTimeout(refreshTimeout);
        context.signal.removeEventListener("abort", onAbort);
        if (options?.signal?.aborted) fail("CANCELLED");
        if (context.signal.aborted) fail("REFRESH_OUTCOME_UNKNOWN");
        fail("REFRESH_OUTCOME_UNKNOWN");
      }
      if (response.status >= 400 && response.status < 500) fail("REFRESH_REJECTED");
      if (!response.ok) { outcome.remoteSucceeded = true; fail("REFRESH_OUTCOME_UNKNOWN"); }
      outcome.remoteSucceeded = true;
      let raw: string;
      try { raw = await readBoundedBody(response, refreshController.signal); }
      catch (error) {
        clearTimeout(refreshTimeout);
        context.signal.removeEventListener("abort", onAbort);
        if (error instanceof ShopifyOfflineTokenError && error.code === "REFRESH_RESPONSE_INVALID") throw error;
        if (options?.signal?.aborted) fail("CANCELLED");
        if (context.signal.aborted) fail("REFRESH_OUTCOME_UNKNOWN");
        fail("REFRESH_OUTCOME_UNKNOWN");
      } finally {
        clearTimeout(refreshTimeout);
        context.signal.removeEventListener("abort", onAbort);
      }
      let payload: unknown;
      try { payload = JSON.parse(raw) as unknown; } catch { fail("REFRESH_RESPONSE_INVALID"); }
      if (!isRecord(payload) || !validToken(payload.access_token) || !validToken(payload.refresh_token)
        || !Number.isSafeInteger(payload.expires_in) || (payload.expires_in as number) <= 0 || (payload.expires_in as number) > 86_400
        || !Number.isSafeInteger(payload.refresh_token_expires_in) || (payload.refresh_token_expires_in as number) <= 0 || (payload.refresh_token_expires_in as number) > 7_776_000
        || (payload.expires_in as number) <= 320
        || (payload.scope !== undefined && !validScope(payload.scope))) fail("REFRESH_RESPONSE_INVALID");
      const expires = requestStartedAt + (payload.expires_in as number) * 1000;
      const refreshTokenExpires = requestStartedAt + (payload.refresh_token_expires_in as number) * 1000;
      if (!Number.isFinite(expires) || !Number.isFinite(refreshTokenExpires) || Number.isNaN(new Date(expires).getTime()) || Number.isNaN(new Date(refreshTokenExpires).getTime())) fail("REFRESH_RESPONSE_INVALID");
      const scope = payload.scope === undefined ? row.scope : payload.scope as string;
      try {
        row = await context.transaction.session.update({ where: { id: row.id }, data: {
          accessToken: payload.access_token, expires: new Date(expires), refreshToken: payload.refresh_token,
          refreshTokenExpires: new Date(refreshTokenExpires), scope,
        }, select: SESSION_SELECT });
      } catch { outcome.remoteSucceeded = true; throw new ShopifyOfflineTokenError("REFRESH_OUTCOME_UNKNOWN"); }
      outcome.remoteSucceeded = true;
      return snapshot(row, shopId, context.shop);
    }, outcome);
  }

  async function withSessionLock<T>(shopId: string, work: (context: LockedSessionContext) => Promise<T>, options?: Readonly<{ signal?: AbortSignal }>): Promise<T> {
    const shop = await resolveShop(shopId);
    return runLocked(shop, shopId, options?.signal, work);
  }

  async function withSdkInstallationSessionLock<T>(integrationDomain: string, work: (context: SdkInstallationSessionContext) => Promise<T>): Promise<T> {
    if (typeof integrationDomain !== "string" || !integrationDomain.trim()) fail("INVALID_SESSION");
    const deadline = createDeadline();
    try {
      return await input.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '18s'");
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL", `moda:shopify-offline:v1:${integrationDomain}`);
        let value: T;
        try { value = await deadline.wait(work(Object.freeze({ transaction: tx, shopId: null, shop: integrationDomain, sessionId: null, signal: deadline.signal }))); }
        catch (error) { deadline.check(); throw new CallbackFailure(error); }
        deadline.check();
        return value;
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof CallbackFailure) throw error.value;
      if (error instanceof ShopifyOfflineTokenError) throw error;
      if (deadline.signal.aborted) deadline.check();
      throw mapDatabaseError(error);
    } finally { deadline.dispose(); }
  }

  return Object.freeze({
    withSdkInstallationSessionLock,
    getAccessToken: async (shopId: string, options?: Readonly<{ signal?: AbortSignal }>) => (await getSession(shopId, options)).accessToken,
    getSession,
    withSessionLock,
  });
}
