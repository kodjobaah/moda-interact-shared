import { createOperationalIncidentKey, parseOperationalIncidentOccurrenceV1 } from "./index.js";
import type { OperationalIncidentOccurrenceV1 } from "./index.js";

/** Durable outcome of one occurrence; duplicate deliveries have no side effects. */
export type IncidentReportResult = {
  incidentKey: string;
  recorded: boolean;
  occurrenceCount: number;
  status: "OPEN" | "RESOLVED";
};

export type IncidentSnapshot = {
  incidentKey: string;
  status: "OPEN" | "RESOLVED";
  occurrenceCount: number;
  lastOccurredAt: Date;
};

/**
 * Transactional persistence contract, implemented by the consuming service.
 * transactionForKey MUST serialize operations for the same key across processes,
 * INCLUDING first creation; the callback must be retried on a conflicting insert.
 * insertOccurrenceIfNew MUST enforce a GLOBAL unique occurrenceId (not only per
 * incident); an occurrenceId already belonging to another key MUST throw.
 * On creation loadOrCreate MUST initialise occurrenceCount=1; recordOccurrence
 * MUST NOT increment that first occurrence again. If a duplicate is encountered
 * when newlyCreated=true, the transaction MUST fail and roll back creation.
 * Every operation in this port, including optional support notification, MUST
 * participate in the SAME database transaction and roll back together.
 */
export interface IncidentTransaction {
  loadOrCreate(input: { incidentKey: string; occurrence: OperationalIncidentOccurrenceV1 }): Promise<IncidentSnapshot & { newlyCreated: boolean }>;
  insertOccurrenceIfNew(input: { incidentKey: string; occurrence: OperationalIncidentOccurrenceV1 }): Promise<boolean>;
  recordOccurrence(input: {
    incidentKey: string;
    occurrence: OperationalIncidentOccurrenceV1;
    reopen: boolean;
    newlyCreated: boolean;
  }): Promise<IncidentSnapshot>;
  /** Optional, safe internal support projection; at most one per incident key. */
  notifySupportOnce?(input: { incidentKey: string; occurrence: OperationalIncidentOccurrenceV1 }): Promise<void>;
}
export interface IncidentPersistence {
  transactionForKey<T>(key: string, fn: (tx: IncidentTransaction) => Promise<T>): Promise<T>;
}
export interface IncidentReporterLogger {
  error(event: string, fields: Record<string, unknown>): void;
}

/** Reporter never turns an operational-notification failure into the producer's failure. */
export function createOperationalIncidentReporter(options: {
  persistence: IncidentPersistence;
  logger: IncidentReporterLogger;
  notifySupport?: boolean;
}) {
  return {
    async report(raw: unknown): Promise<IncidentReportResult | null> {
      let occurrence: OperationalIncidentOccurrenceV1;
      try {
        occurrence = parseOperationalIncidentOccurrenceV1(raw);
      } catch {
        // Fail closed, and do not log potentially sensitive invalid payloads.
        options.logger.error("operational_incident.invalid_occurrence", {});
        return null;
      }
      const incidentKey = createOperationalIncidentKey({
        sourceService: occurrence.sourceService, environment: occurrence.environment,
        category: occurrence.category, reasonCode: occurrence.reasonCode,
        resourceKey: occurrence.resourceKey, shopId: occurrence.shopId,
      });
      try {
        return await options.persistence.transactionForKey(incidentKey, async (tx) => {
          const current = await tx.loadOrCreate({ incidentKey, occurrence });
          const recorded = await tx.insertOccurrenceIfNew({ incidentKey, occurrence });
          if (!recorded) {
            return { incidentKey, recorded: false, occurrenceCount: current.occurrenceCount,
              status: current.status };
          }
          const updated = await tx.recordOccurrence({ incidentKey, occurrence,
            reopen: current.status === "RESOLVED", newlyCreated: current.newlyCreated });
          if (options.notifySupport && occurrence.shopId !== null && tx.notifySupportOnce) {
            await tx.notifySupportOnce({ incidentKey, occurrence });
          }
          return { incidentKey, recorded: true, occurrenceCount: updated.occurrenceCount,
            status: "OPEN" as const };
        });
      } catch {
        options.logger.error("operational_incident.report_failed", {
          incidentKey, sourceService: occurrence.sourceService,
          environment: occurrence.environment, occurrenceId: occurrence.occurrenceId,
        });
        return null;
      }
    },
  };
}
