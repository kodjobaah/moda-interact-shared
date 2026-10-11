import assert from "node:assert/strict";
import { test } from "node:test";
import { createOperationalIncidentKey, parseOperationalIncidentOccurrenceV1 } from "./index.js";
import type { OperationalIncidentOccurrenceV1 } from "./index.js";
const valid = {
  contractVersion: "operational-incident.v1", sourceService: "background", environment: "test",
  category: "INTEGRATION_ACCESS", reasonCode: "SHOPIFY_ACCESS_REVOKED", resourceKey: "recovery:123",
  shopId: "shop-1", severity: "HIGH", occurrenceId: "00000000-0000-4000-8000-000000000001",
  correlationId: "error-123", occurredAt: "2026-10-11T15:00:00.000Z",
} as const;
test("strict v1 occurrence accepts safe bounded fields", () => {
  assert.equal(parseOperationalIncidentOccurrenceV1(valid).sourceService, "background");
});
test("rejects arbitrary metadata, tokens, raw failures and unknown versions", () => {
  for (const key of ["metadata", "headers", "token", "error", "customerPayload"]) {
    assert.throws(() => parseOperationalIncidentOccurrenceV1({ ...valid, [key]: "secret" }));
  }
  assert.throws(() => parseOperationalIncidentOccurrenceV1({ ...valid, contractVersion: "v2" }));
});
test("rejects unsafe or unbounded identifiers and malformed occurrences", () => {
  for (const patch of [{ sourceService: "bad service" }, { reasonCode: "x".repeat(129) },
    { environment: "production-copy" }, { occurrenceId: "not-a-uuid" },
    { correlationId: "Bearer secret value" }, { severity: "UNKNOWN" }, { shopId: "" }]) {
    assert.throws(() => parseOperationalIncidentOccurrenceV1({ ...valid, ...patch }));
  }
});
test("stable grouping excludes occurrence identity and severity but includes tenant and environment", () => {
  const keyFor = (occurrence: OperationalIncidentOccurrenceV1) => createOperationalIncidentKey({
    sourceService: occurrence.sourceService, environment: occurrence.environment,
    category: occurrence.category, reasonCode: occurrence.reasonCode,
    resourceKey: occurrence.resourceKey, shopId: occurrence.shopId,
  });
  const a = keyFor(valid);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, keyFor({ ...valid, occurrenceId: "00000000-0000-4000-8000-000000000002",
    severity: "LOW", correlationId: "error-456", occurredAt: "2026-10-11T16:00:00.000Z" }));
  const changes: Partial<OperationalIncidentOccurrenceV1>[] = [
    { environment: "production" }, { shopId: "shop-2" }, { sourceService: "mcp" },
    { resourceKey: "recovery:234" }, { reasonCode: "OTHER" },
  ];
  for (const patch of changes) {
    assert.notEqual(a, keyFor({ ...valid, ...patch }));
  }
});
test("platform-wide events support explicit null shop", () => {
  assert.equal(parseOperationalIncidentOccurrenceV1({ ...valid, shopId: null }).shopId, null);
});
