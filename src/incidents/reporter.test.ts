import assert from "node:assert/strict";
import { test } from "node:test";
import { createOperationalIncidentReporter } from "./reporter.js";
import type { IncidentPersistence, IncidentSnapshot, IncidentTransaction } from "./reporter.js";

const first = {
  contractVersion: "operational-incident.v1", sourceService: "background", environment: "test",
  category: "INTEGRATION_ACCESS", reasonCode: "SHOPIFY_ACCESS_REVOKED", resourceKey: "recovery:123",
  shopId: "shop-1", severity: "HIGH", occurrenceId: "00000000-0000-4000-8000-000000000001",
  correlationId: "error-123", occurredAt: "2026-10-11T15:00:00.000Z",
} as const;

function fixture() {
  let incidents = new Map<string, IncidentSnapshot>();
  let occurrences = new Map<string, string>();
  let support = new Set<string>();
  let events = 0;
  let notifyCalls = 0;
  let failSupport = false;
  // Globally serializable test adapter; mirrors a single database transaction's rollback.
  let tail: Promise<unknown> = Promise.resolve();
  const persistence: IncidentPersistence = {
    transactionForKey: async (_key, fn) => {
      const predecessor = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await predecessor;
      const cloned = new Map([...incidents].map(([k, v]) => [k, { ...v }]));
      const occurrenceCopy = new Map(occurrences);
      const supportCopy = new Set(support);
      let eventCopy = events;
      let notifyCopy = notifyCalls;
      const tx: IncidentTransaction = {
        loadOrCreate: async ({ incidentKey, occurrence }) => {
          const existing = cloned.get(incidentKey);
          if (existing) return { ...existing, newlyCreated: false };
          const fresh: IncidentSnapshot = {
            incidentKey, status: "OPEN", occurrenceCount: 1,
            lastOccurredAt: new Date(occurrence.occurredAt),
          };
          cloned.set(incidentKey, fresh);
          return { ...fresh, newlyCreated: true };
        },
        insertOccurrenceIfNew: async ({ incidentKey, occurrence }) => {
          const owner = occurrenceCopy.get(occurrence.occurrenceId);
          if (owner && owner !== incidentKey) throw Error("occurrence ownership collision");
          if (owner) return false;
          occurrenceCopy.set(occurrence.occurrenceId, incidentKey);
          eventCopy++;
          return true;
        },
        recordOccurrence: async ({ incidentKey, occurrence, newlyCreated }) => {
          const current = cloned.get(incidentKey)!;
          const next = { ...current, status: "OPEN" as const,
            occurrenceCount: current.occurrenceCount + (newlyCreated ? 0 : 1),
            lastOccurredAt: new Date(Math.max(current.lastOccurredAt.getTime(), Date.parse(occurrence.occurredAt))) };
          cloned.set(incidentKey, next);
          return next;
        },
        notifySupportOnce: async ({ incidentKey }) => {
          if (failSupport) throw Error("simulated persistence failure");
          if (!supportCopy.has(incidentKey)) { supportCopy.add(incidentKey); notifyCopy++; }
        },
      };
      try {
        const result = await fn(tx);
        incidents = cloned; occurrences = occurrenceCopy; support = supportCopy;
        events = eventCopy; notifyCalls = notifyCopy;
        return result;
      } finally { release(); }
    },
  };
  const errors: { event: string; fields: Record<string, unknown> }[] = [];
  const reporter = createOperationalIncidentReporter({ persistence, notifySupport: true,
    logger: { error: (event, fields) => { errors.push({ event, fields }); } } });
  return { reporter, errors, stats: () => ({ incidents, occurrences, support, events, notifyCalls }),
    failSupport: (value: boolean) => { failSupport = value; } };
}

test("first report, retry and concurrent new occurrence are transactionally idempotent", async () => {
  const f = fixture();
  const one = await f.reporter.report(first);
  assert.equal(one?.recorded, true);
  assert.equal(one?.occurrenceCount, 1);
  const duplicate = await f.reporter.report(first);
  assert.equal(duplicate?.recorded, false);
  const second = { ...first, occurrenceId: "00000000-0000-4000-8000-000000000002" };
  const results = await Promise.all(Array.from({ length: 10 }, () => f.reporter.report(second)));
  assert.equal(results.filter((r) => r?.recorded).length, 1);
  assert.equal(f.stats().events, 2);
  assert.equal(f.stats().notifyCalls, 1);
  assert.equal([...f.stats().incidents.values()][0]?.occurrenceCount, 2);
});

test("reporter reopens resolved incident on new occurrence", async () => {
  const f = fixture();
  const one = await f.reporter.report(first);
  f.stats().incidents.get(one!.incidentKey)!.status = "RESOLVED";
  const two = await f.reporter.report({ ...first, occurrenceId: "00000000-0000-4000-8000-000000000003" });
  assert.equal(two?.status, "OPEN");
  assert.equal(f.stats().incidents.get(one!.incidentKey)?.status, "OPEN");
});

test("notification persistence failure rolls back occurrence and never propagates", async () => {
  const f = fixture();
  f.failSupport(true);
  assert.equal(await f.reporter.report(first), null);
  assert.equal(f.stats().events, 0);
  assert.equal(f.stats().incidents.size, 0);
  assert.equal(f.errors[0]?.event, "operational_incident.report_failed");
  f.failSupport(false);
  assert.equal((await f.reporter.report(first))?.recorded, true);
});

test("invalid payloads do not persist or leak input to logs", async () => {
  const f = fixture();
  assert.equal(await f.reporter.report({ ...first, headers: "Bearer confidential" }), null);
  assert.equal(f.stats().events, 0);
  assert.deepEqual(f.errors[0]?.fields, {});
});

test("one UUID cannot be reassigned to another incident group", async () => {
  const f = fixture();
  await f.reporter.report(first);
  assert.equal(await f.reporter.report({ ...first, shopId: "shop-2" }), null);
  assert.equal(f.stats().incidents.size, 1);
  assert.equal(f.stats().events, 1);
});
