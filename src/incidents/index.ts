import { createHash } from "node:crypto";
import { z } from "zod";

// ARCH-033 v1: safe, internal-only occurrence envelope. Producer classifies actionability.
export const OPERATIONAL_INCIDENT_CONTRACT_VERSION = "operational-incident.v1" as const;
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const smallIdentifier = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const opaqueId = z.string().uuid();
export const OperationalIncidentOccurrenceV1Schema = z.strictObject({
  contractVersion: z.literal(OPERATIONAL_INCIDENT_CONTRACT_VERSION),
  sourceService: smallIdentifier,
  environment: z.enum(["local", "development", "test", "staging", "production"]),
  category: smallIdentifier,
  reasonCode: identifier,
  resourceKey: identifier,
  shopId: z.string().min(1).max(128).nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  occurrenceId: opaqueId,
  correlationId: identifier,
  occurredAt: z.iso.datetime({ offset: true }),
  // Deliberately no arbitrary metadata bag, message, headers or exception object.
});
export type OperationalIncidentOccurrenceV1 = z.infer<typeof OperationalIncidentOccurrenceV1Schema>;
export function parseOperationalIncidentOccurrenceV1(input: unknown): OperationalIncidentOccurrenceV1 {
  return OperationalIncidentOccurrenceV1Schema.parse(input);
}
export function createOperationalIncidentKey(input: Pick<OperationalIncidentOccurrenceV1,
  "sourceService" | "environment" | "category" | "reasonCode" | "resourceKey" | "shopId">): string {
  const parsed = OperationalIncidentOccurrenceV1Schema.pick({
    sourceService: true, environment: true, category: true, reasonCode: true, resourceKey: true, shopId: true,
  }).parse(input);
  return createHash("sha256").update(JSON.stringify([
    "operational-incident-key.v1", parsed.sourceService, parsed.environment, parsed.category,
    parsed.reasonCode, parsed.shopId, parsed.resourceKey,
  ])).digest("hex");
}
