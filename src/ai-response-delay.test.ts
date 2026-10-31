import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_RESPONSE_DELAY_SCHEMA_VERSION,
  AiResponseDelayMinutesSchema,
  AiResponseDelayRevisionSchema,
  MerchantAiResponseDelayReadV1Schema,
  MerchantAiResponseDelayWriteV1Schema,
} from "./ai-response-delay";

const timestampRevision = "2026-10-31T16:28:55.123Z";

test("publishes the v1 response-delay wire version", () => {
  assert.equal(AI_RESPONSE_DELAY_SCHEMA_VERSION, 1);
});

test("accepts the inclusive 0–30 minute range for reads and writes", () => {
  for (const aiResponseDelayMinutes of [0, 1, 7, 30]) {
    assert.equal(AiResponseDelayMinutesSchema.safeParse(aiResponseDelayMinutes).success, true);
    assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
      schemaVersion: 1,
      revision: timestampRevision,
      aiResponseDelayMinutes,
    }).success, true);
    assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
      schemaVersion: 1,
      expectedRevision: "UNCONFIGURED",
      aiResponseDelayMinutes,
    }).success, true);
  }
});

test("rejects values outside the integer 0–30 range and missing values", () => {
  for (const value of [-1, 31, 0.5, "7", null, undefined]) {
    assert.equal(AiResponseDelayMinutesSchema.safeParse(value).success, false);
    assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
      schemaVersion: 1,
      revision: timestampRevision,
      aiResponseDelayMinutes: value,
    }).success, false);
    assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
      schemaVersion: 1,
      expectedRevision: "UNCONFIGURED",
      aiResponseDelayMinutes: value,
    }).success, false);
  }

  assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
    schemaVersion: 1,
    revision: timestampRevision,
  }).success, false);
  assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
    schemaVersion: 1,
    expectedRevision: "UNCONFIGURED",
  }).success, false);
});

test("accepts both revision forms and rejects malformed timestamp shapes", () => {
  for (const revision of ["UNCONFIGURED", timestampRevision]) {
    assert.equal(AiResponseDelayRevisionSchema.safeParse(revision).success, true);
    assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
      schemaVersion: 1,
      revision,
      aiResponseDelayMinutes: 7,
    }).success, true);
    assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
      schemaVersion: 1,
      expectedRevision: revision,
      aiResponseDelayMinutes: 7,
    }).success, true);
  }

  for (const revision of [
    "2026-10-31T16:28:55Z",
    "2026-10-31",
    "2026-10-31T16:28:55.123+00:00",
    "not-a-revision",
  ]) {
    assert.equal(AiResponseDelayRevisionSchema.safeParse(revision).success, false);
    assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
      schemaVersion: 1,
      revision,
      aiResponseDelayMinutes: 7,
    }).success, false);
    assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
      schemaVersion: 1,
      expectedRevision: revision,
      aiResponseDelayMinutes: 7,
    }).success, false);
  }
});

test("strictly rejects unknown fields and wrong schema versions", () => {
  assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
    schemaVersion: 1,
    revision: timestampRevision,
    aiResponseDelayMinutes: 7,
    shopId: "forged",
  }).success, false);
  assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
    schemaVersion: 1,
    expectedRevision: "UNCONFIGURED",
    aiResponseDelayMinutes: 7,
    shopId: "forged",
  }).success, false);
  assert.equal(MerchantAiResponseDelayReadV1Schema.safeParse({
    schemaVersion: 2,
    revision: timestampRevision,
    aiResponseDelayMinutes: 7,
  }).success, false);
  assert.equal(MerchantAiResponseDelayWriteV1Schema.safeParse({
    schemaVersion: 2,
    expectedRevision: "UNCONFIGURED",
    aiResponseDelayMinutes: 7,
  }).success, false);
});
