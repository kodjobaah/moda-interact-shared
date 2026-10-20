import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { createOperationalIncidentReporter } from "./reporter.js";
import { createPrismaOperationalIncidentPersistence } from "./postgres.js";
import type { OperationalIncidentSqlClient, OperationalIncidentPrismaClient } from "./postgres.js";

if (!process.env.ARCH033_DISPOSABLE_POSTGRES) throw new Error("Only run with the disposable PostgreSQL harness");
const dbRepo = resolve(process.cwd(), "../moda-interact-database");
const requireDatabase = createRequire(resolve(dbRepo, "package.json"));
const { PrismaClient } = requireDatabase("@prisma/client") as {
  PrismaClient: new (options?: { datasources?: { db: { url: string } } }) => OperationalIncidentPrismaClient & {
    $disconnect(): Promise<void>;
    $queryRawUnsafe<T>(query: string, ...params: unknown[]): Promise<T>;
  };
};
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
const notifications: string[] = [];
let failNotification = false;
const persistence = createPrismaOperationalIncidentPersistence({
  prisma,
  supportWriter: async ({ tx, incidentKey, occurrence }) => {
    if (failNotification) throw new Error("forced support write failure");
    // Support projections must be idempotent and inside the reporter transaction.
    const result = await tx.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO support."MerchantSupportMessage"
       ("id","threadId","kind","state","originalBody","sourceLanguageTag","systemCode","systemVersion","sourceKey","updatedAt")
      VALUES ($1,$2,'SYSTEM','AVAILABLE','Internal operational notice','en','OPERATIONAL_INCIDENT','v1',$3,now())
      ON CONFLICT ("sourceKey") DO NOTHING RETURNING "id"`,
      randomUUID(), "arch033-support-thread", `arch033:${incidentKey}`);
    if (result.length) notifications.push(occurrence.occurrenceId);
  },
});
const reporter = createOperationalIncidentReporter({ persistence, notifySupport: true,
  logger: { error: () => {} } });
const keyOccurrence = (id: string, reasonCode = "INTEGRATION_REVOKED") => ({
  contractVersion: "operational-incident.v1", sourceService: "background",
  environment: "test", category: "INTEGRATION_ACCESS", reasonCode,
  resourceKey: "recovery:123", shopId: "arch033-shop", severity: "HIGH",
  occurrenceId: id, correlationId: `corr-${id}`, occurredAt: new Date().toISOString(),
});
const query = <T>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args);

try {
  await test("real PostgreSQL: first occurrence, duplicate, concurrent events and support dedup", async () => {
    const id1 = randomUUID();
    const errorMessage = "PlatformConfigurationFailure: Platform configuration missing (messaging.sender)";
    const one = await reporter.report({ ...keyOccurrence(id1), errorMessage });
    assert.equal(one?.recorded, true);
    assert.equal(one?.occurrenceCount, 1);
    const [incident] = await query<{ lastErrorMessage: string }>(
      `SELECT "lastErrorMessage" FROM support."OperationalIncident" WHERE "incidentKey"=$1`, one!.incidentKey);
    assert.equal(incident?.lastErrorMessage, errorMessage);
    const [event] = await query<{ errorMessage: string }>(
      `SELECT "errorMessage" FROM support."OperationalIncidentEvent" WHERE "id"=$1::uuid`, id1);
    assert.equal(event?.errorMessage, errorMessage);
    const duplicate = await reporter.report({ ...keyOccurrence(id1), errorMessage: "must not overwrite" });
    assert.equal(duplicate?.recorded, false);
    assert.equal((await query<{ lastErrorMessage: string }>(
      `SELECT "lastErrorMessage" FROM support."OperationalIncident" WHERE "incidentKey"=$1`, one!.incidentKey))[0]?.lastErrorMessage, errorMessage);
    const id2 = randomUUID();
    const responses = await Promise.all(Array.from({ length: 8 }, () => reporter.report(keyOccurrence(id2))));
    assert.equal(responses.filter(x => x?.recorded).length, 1);
    assert.equal((await query<{ occurrenceCount: number }>(
      `SELECT "occurrenceCount" FROM support."OperationalIncident" WHERE "incidentKey" = $1`, one!.incidentKey))[0]!.occurrenceCount, 2);
    assert.equal((await query<{ count: bigint }>(
      `SELECT count(*) FROM support."OperationalIncidentEvent" WHERE "eventType"='OCCURRED'`))[0]!.count, 2n);
    assert.equal((await query<{ count: bigint }>(
      `SELECT count(*) FROM support."MerchantSupportMessage" WHERE "sourceKey" = $1`,
      `arch033:${one!.incidentKey}`))[0]!.count, 1n);
  });
  await test("real PostgreSQL: latest diagnostic follows occurrence time and event history", async () => {
    const firstOccurredAt = "2026-10-20T10:00:00.000Z";
    const base = { ...keyOccurrence(randomUUID(), "ERROR_MESSAGE_ORDERING"), occurredAt: firstOccurredAt,
      errorMessage: "initial diagnostic" };
    const first = await reporter.report(base);
    assert.equal(first?.recorded, true);

    const stale = await reporter.report({ ...base, occurrenceId: randomUUID(),
      occurredAt: "2026-10-20T09:00:00.000Z", errorMessage: "stale diagnostic" });
    assert.equal(stale?.recorded, true);
    const messageLess = await reporter.report({ ...base, occurrenceId: randomUUID(),
      occurredAt: "2026-10-20T11:00:00.000Z", errorMessage: undefined });
    assert.equal(messageLess?.recorded, true);
    const latest = await reporter.report({ ...base, occurrenceId: randomUUID(),
      occurredAt: "2026-10-20T12:00:00.000Z", errorMessage: "latest diagnostic" });
    assert.equal(latest?.recorded, true);

    assert.equal((await query<{ lastErrorMessage: string }>(
      `SELECT "lastErrorMessage" FROM support."OperationalIncident" WHERE "incidentKey"=$1`,
      first!.incidentKey))[0]?.lastErrorMessage, "latest diagnostic");
    assert.deepEqual((await query<{ errorMessage: string | null }>(
      `SELECT "errorMessage" FROM support."OperationalIncidentEvent"
       WHERE "incidentId"=(SELECT "id" FROM support."OperationalIncident" WHERE "incidentKey"=$1)
       ORDER BY "occurredAt", "id"`, first!.incidentKey)).map((event) => event.errorMessage),
      ["stale diagnostic", "initial diagnostic", null, "latest diagnostic"]);
  });
  await test("real PostgreSQL: globally reused occurrence UUID on other incident is rejected", async () => {
    const reused = (await query<{ id: string }>(`SELECT "id" FROM support."OperationalIncidentEvent" WHERE "eventType"='OCCURRED' LIMIT 1`))[0]!.id;
    assert.equal(await reporter.report(keyOccurrence(reused, "DIFFERENT_FAILURE")), null);
    assert.equal((await query<{ count: bigint }>(
      `SELECT count(*) FROM support."OperationalIncident" WHERE "reasonCode"='DIFFERENT_FAILURE'`))[0]!.count, 0n);
  });
  await test("real PostgreSQL: support failure rolls back incident and occurrence", async () => {
    failNotification = true;
    const id = randomUUID();
    assert.equal(await reporter.report(keyOccurrence(id, "SUPPORT_TEST_FAILURE")), null);
    assert.equal((await query<{ count: bigint }>(
      `SELECT count(*) FROM support."OperationalIncidentEvent" WHERE "id"=$1::uuid`, id))[0]!.count, 0n);
    assert.equal((await query<{ count: bigint }>(
      `SELECT count(*) FROM support."OperationalIncident" WHERE "reasonCode"='SUPPORT_TEST_FAILURE'`))[0]!.count, 0n);
    failNotification = false;
  });
  await test("real PostgreSQL: resolved incident reopens and preserves audit", async () => {
    const existing = (await query<{ id: string; incidentKey: string }>(
      `SELECT "id", "incidentKey" FROM support."OperationalIncident" WHERE "reasonCode"='INTEGRATION_REVOKED' LIMIT 1`))[0]!;
    // Fixture administrator is part of disposable DB only.
    await prisma.$queryRawUnsafe(`UPDATE support."OperationalIncident"
      SET "status"='RESOLVED',"resolvedAt"=now(),
      "resolvedByPlatformAdminId"='arch033-admin',"resolutionNote"='Test resolution'
      WHERE "id"=$1 RETURNING "id"`, existing.id);
    const next = await reporter.report(keyOccurrence(randomUUID()));
    assert.equal(next?.status, "OPEN");
    assert.equal((await query<{ count: bigint }>(`SELECT count(*) FROM support."OperationalIncidentEvent"
      WHERE "incidentId"=$1 AND "eventType"='REOPENED'`, existing.id))[0]!.count, 1n);
    assert.equal((await query<{ status: string }>(`SELECT "status" FROM support."OperationalIncident"
      WHERE "id"=$1`, existing.id))[0]!.status, "OPEN");
  });
  assert.equal(notifications.length, 2);
  console.log("PASS ARCH-033 Shared reporter PostgreSQL transactions, concurrency, dedup, rollback and reopen");
} finally {
  await prisma.$disconnect();
}
