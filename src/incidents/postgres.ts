import { randomUUID } from "node:crypto";
import type { OperationalIncidentOccurrenceV1 } from "./index.js";
import type { IncidentPersistence, IncidentSnapshot, IncidentTransaction } from "./reporter.js";

/** A deliberately small interface; the application's Prisma transaction client supplies it. */
export interface OperationalIncidentSqlClient {
  $queryRawUnsafe<T = unknown>(query: string, ...parameters: unknown[]): Promise<T>;
}
export interface OperationalIncidentPrismaClient {
  $transaction<T>(fn: (tx: OperationalIncidentSqlClient) => Promise<T>, options?: {
    maxWait?: number; timeout?: number; isolationLevel?: "Serializable";
  }): Promise<T>;
}

/** Optional merchant-support projection. This callback MUST use the supplied transaction. */
export type OperationalIncidentSupportWriter = (input: {
  tx: OperationalIncidentSqlClient;
  incidentId: string;
  incidentKey: string;
  occurrence: OperationalIncidentOccurrenceV1;
}) => Promise<void>;

interface IncidentRow {
  id: string;
  incidentKey: string;
  status: "OPEN" | "RESOLVED";
  occurrenceCount: number;
  lastOccurredAt: Date;
}

async function rows<T>(tx: OperationalIncidentSqlClient, statement: string, ...params: unknown[]): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(statement, ...params);
}

function snapshot(row: IncidentRow): IncidentSnapshot {
  return { incidentKey: row.incidentKey, status: row.status,
    occurrenceCount: row.occurrenceCount, lastOccurredAt: row.lastOccurredAt };
}

class PgIncidentTransaction implements IncidentTransaction {
  private incidentId: string | null = null;
  private newIncident = false;
  constructor(private readonly tx: OperationalIncidentSqlClient,
    private readonly supportWriter?: OperationalIncidentSupportWriter) {}

  async loadOrCreate({ incidentKey, occurrence }: {
    incidentKey: string; occurrence: OperationalIncidentOccurrenceV1;
  }): Promise<IncidentSnapshot & { newlyCreated: boolean }> {
    const inserted = await rows<IncidentRow>(this.tx, `
      INSERT INTO support."OperationalIncident" (
        "id", "incidentKey", "sourceService", "environment", "category", "reasonCode",
        "resourceKey", "shopId", "severity", "status", "occurrenceCount",
        "firstOccurredAt", "lastOccurredAt", "lastCorrelationId")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',1,$10::timestamptz,$10::timestamptz,$11)
      ON CONFLICT ("incidentKey") DO NOTHING RETURNING *`,
      randomUUID(), incidentKey, occurrence.sourceService, occurrence.environment,
      occurrence.category, occurrence.reasonCode, occurrence.resourceKey,
      occurrence.shopId, occurrence.severity, occurrence.occurredAt, occurrence.correlationId);
    this.newIncident = inserted.length > 0;
    const found = await rows<IncidentRow>(this.tx,
      `SELECT * FROM support."OperationalIncident" WHERE "incidentKey" = $1 FOR UPDATE`, incidentKey);
    if (found.length !== 1) throw new Error("incident row not found after upsert");
    this.incidentId = found[0]!.id;
    return { ...snapshot(found[0]!), newlyCreated: this.newIncident };
  }

  async insertOccurrenceIfNew({ incidentKey, occurrence }: {
    incidentKey: string; occurrence: OperationalIncidentOccurrenceV1;
  }): Promise<boolean> {
    if (!this.incidentId) throw new Error("incident not loaded");
    const created = await rows<{ id: string }>(this.tx, `
      INSERT INTO support."OperationalIncidentEvent"
        ("id", "incidentId", "eventType", "correlationId", "occurredAt")
      VALUES ($1::uuid, $2, 'OCCURRED', $3, $4::timestamptz)
      ON CONFLICT ("id") DO NOTHING RETURNING "id"`,
      occurrence.occurrenceId, this.incidentId, occurrence.correlationId, occurrence.occurredAt);
    if (!created.length) {
      if (this.newIncident) throw new Error("duplicate occurrence cannot create new incident");
      const existing = await rows<{ incidentKey: string }>(this.tx, `
        SELECT i."incidentKey" FROM support."OperationalIncidentEvent" e
        JOIN support."OperationalIncident" i ON i."id" = e."incidentId"
        WHERE e."id" = $1::uuid`, occurrence.occurrenceId);
      if (existing.length !== 1 || existing[0]!.incidentKey !== incidentKey) {
        throw new Error("occurrence already belongs to another incident");
      }
      return false;
    }
    return true;
  }

  async recordOccurrence({ incidentKey, occurrence, reopen, newlyCreated }: {
    incidentKey: string; occurrence: OperationalIncidentOccurrenceV1;
    reopen: boolean; newlyCreated: boolean;
  }): Promise<IncidentSnapshot> {
    if (!this.incidentId) throw new Error("incident not loaded");
    if (reopen) {
      await rows(this.tx, `INSERT INTO support."OperationalIncidentEvent"
        ("id", "incidentId", "eventType", "correlationId", "occurredAt")
        VALUES ($1::uuid,$2,'REOPENED',$3,$4::timestamptz)`,
        randomUUID(), this.incidentId, occurrence.correlationId, occurrence.occurredAt);
    }
    const updated = await rows<IncidentRow>(this.tx, `
      UPDATE support."OperationalIncident" SET
        "occurrenceCount" = "occurrenceCount" + $2::integer,
        "lastOccurredAt" = GREATEST("lastOccurredAt", $3::timestamptz),
        "lastCorrelationId" = $4,
        "severity" = $5,
        "status" = 'OPEN', "resolvedAt" = NULL,
        "resolvedByPlatformAdminId" = NULL, "resolutionNote" = NULL,
        "revision" = "revision" + 1
      WHERE "incidentKey" = $1 RETURNING *`, incidentKey,
      newlyCreated ? 0 : 1, occurrence.occurredAt, occurrence.correlationId, occurrence.severity);
    if (updated.length !== 1) throw new Error("incident update failed");
    return snapshot(updated[0]!);
  }

  async notifySupportOnce(input: { incidentKey: string; occurrence: OperationalIncidentOccurrenceV1 }): Promise<void> {
    if (this.supportWriter && this.incidentId) await this.supportWriter({
      tx: this.tx, incidentId: this.incidentId,
      incidentKey: input.incidentKey, occurrence: input.occurrence,
    });
  }
}

function retryable(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code : undefined;
  return code === "P2034" || code === "40001" || code === "40P01";
}

/**
 * PostgreSQL/Prisma adapter. No global Prisma client or credentials are created.
 * All writes and an optional support projection occur within a single transaction.
 * Uses a per-key transaction advisory lock and a row lock for cross-process safety.
 */
export function createPrismaOperationalIncidentPersistence(options: {
  prisma: OperationalIncidentPrismaClient;
  supportWriter?: OperationalIncidentSupportWriter;
  maxAttempts?: number;
}): IncidentPersistence {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("maxAttempts must be between 1 and 10");
  }
  return {
    async transactionForKey<T>(key: string, fn: (tx: IncidentTransaction) => Promise<T>): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        try {
          return await options.prisma.$transaction(async (tx) => {
            await rows(tx, `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS acquired`, key);
            return fn(new PgIncidentTransaction(tx, options.supportWriter));
          }, { isolationLevel: "Serializable", timeout: 15000 });
        } catch (error) {
          if (attempt >= maxAttempts || !retryable(error)) throw error;
        }
      }
    },
  };
}
