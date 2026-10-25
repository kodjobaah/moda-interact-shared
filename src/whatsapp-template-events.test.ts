import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  META_TEMPLATE_STATUS_JOB,
  META_TEMPLATE_STATUS_QUEUE,
  META_TEMPLATE_STATUS_SCHEMA_VERSION,
  MetaTemplateStatusObservationV2Schema,
  formatMetaTemplateStatusEventIdentity,
  formatMetaTemplateStatusJobId,
  type MetaTemplateStatusObservationV2,
} from "./whatsapp-template-events.js";

interface FixtureVector {
  case: string;
  observation: MetaTemplateStatusObservationV2;
  expectedJobId: string;
}
interface CompatibilityFixture {
  observation: MetaTemplateStatusObservationV2;
  expectedJobId: string;
  additionalObservations: FixtureVector[];
}

const fixture = JSON.parse(readFileSync(
  new URL("../fixtures/meta-template-status-v2.json", import.meta.url), "utf8",
)) as CompatibilityFixture;

const expectedKeys = [
  "schemaVersion", "eventIdentity", "wabaId", "providerTemplateId",
  "providerTemplateName", "providerLanguageCode", "providerStatus",
  "reasonCode", "receivedAt",
].sort();
const primaryUuid = "550e8400-e29b-41d4-a716-446655440000";
const primaryJobId = `meta-template-status-v2-${primaryUuid}`;
const primaryIdentity = `meta-template-status:v2:${primaryUuid}`;

function isRejected(overrides: Record<string, unknown>): boolean {
  return !MetaTemplateStatusObservationV2Schema.safeParse({ ...fixture.observation, ...overrides }).success;
}

function observationId(eventIdentity: string): string {
  return eventIdentity.slice("meta-template-status:v2:".length);
}

test("wire constants and exact historical-independent v2 golden fixture", () => {
  assert.equal(META_TEMPLATE_STATUS_QUEUE, "whatsapp-events");
  assert.equal(META_TEMPLATE_STATUS_JOB, "meta-template-status-update");
  assert.equal(META_TEMPLATE_STATUS_SCHEMA_VERSION, 2);
  assert.deepEqual(fixture.observation, {
    schemaVersion: 2,
    eventIdentity: primaryIdentity,
    wabaId: "123456789",
    providerTemplateId: "987654321",
    providerTemplateName: "checkout_recovery_initial_v2",
    providerLanguageCode: "en_GB",
    providerStatus: "APPROVED",
    reasonCode: "NONE",
    receivedAt: "2026-10-25T19:00:00.000Z",
  });
  assert.equal(fixture.expectedJobId, primaryJobId);
  assert.deepEqual(Object.keys(fixture.observation).sort(), expectedKeys);
  assert.deepEqual(MetaTemplateStatusObservationV2Schema.parse(fixture.observation), fixture.observation);
  assert.deepEqual(MetaTemplateStatusObservationV2Schema.parse(JSON.parse(JSON.stringify(fixture.observation))), fixture.observation);
  assert.ok(new TextEncoder().encode(JSON.stringify(fixture.observation)).byteLength <= 4096);
});

test("pure formatters validate lowercase v4 and use the same occurrence UUID", () => {
  assert.equal(formatMetaTemplateStatusEventIdentity(primaryUuid), primaryIdentity);
  assert.equal(formatMetaTemplateStatusJobId(primaryUuid), primaryJobId);
  assert.equal(formatMetaTemplateStatusJobId(primaryUuid), formatMetaTemplateStatusJobId(primaryUuid));
  assert.ok(!formatMetaTemplateStatusJobId(primaryUuid).includes(":"), "BullMQ job IDs must avoid colons");

  const malformed = [
    "", "550e8400-e29b-11d4-a716-446655440000", // v1
    "550e8400-e29b-71d4-a716-446655440000", // v7
    "550e8400-e29b-41d4-7716-446655440000", // not RFC variant
    "550E8400-E29B-41D4-A716-446655440000", // uppercase
    "550e8400e29b41d4a716446655440000", // no hyphens
    `${primaryIdentity}`, `${primaryUuid}extra`,
    ` ${primaryUuid}`, `${primaryUuid}\n`,
  ];
  for (const input of malformed) {
    for (const formatter of [formatMetaTemplateStatusEventIdentity, formatMetaTemplateStatusJobId]) {
      assert.throws(() => formatter(input), (error: unknown) =>
        error instanceof TypeError && error.message === "observationId must be a lowercase UUID v4",
      );
    }
  }
  assert.throws(() => formatMetaTemplateStatusEventIdentity(42 as unknown as string), TypeError);
});

test("different occurrences survive identical content, later APPROVED and repeated HTTP delivery", () => {
  const vectors = [{case: "initial-approved", observation: fixture.observation, expectedJobId: fixture.expectedJobId}, ...fixture.additionalObservations];
  assert.equal(vectors.length, 6);
  const uniqueIdentities = new Set<string>();
  const uniqueJobs = new Set<string>();
  for (const vector of vectors) {
    const parsed = MetaTemplateStatusObservationV2Schema.parse(vector.observation);
    const uuid = observationId(parsed.eventIdentity);
    assert.equal(formatMetaTemplateStatusEventIdentity(uuid), parsed.eventIdentity);
    assert.equal(formatMetaTemplateStatusJobId(uuid), vector.expectedJobId);
    uniqueIdentities.add(parsed.eventIdentity);
    uniqueJobs.add(vector.expectedJobId);
  }
  assert.equal(uniqueIdentities.size, vectors.length);
  assert.equal(uniqueJobs.size, vectors.length);
  assert.deepEqual(vectors.slice(0, 1).concat(vectors.slice(2, 4)).map((v) => v.observation.providerStatus), ["APPROVED", "PAUSED", "APPROVED"]);
  const first = fixture.observation;
  const second = fixture.additionalObservations[0].observation;
  const a = fixture.additionalObservations.find((v) => v.case === "identical-delivery-first")!;
  const b = fixture.additionalObservations.find((v) => v.case === "identical-delivery-second")!;
  for (const [left, right] of [[first, second], [a.observation, b.observation]]) {
    for (const key of ["wabaId", "providerTemplateId", "providerTemplateName", "providerLanguageCode", "providerStatus", "reasonCode", "receivedAt"] as const) {
      assert.equal(left[key], right[key]);
    }
    assert.notEqual(left.eventIdentity, right.eventIdentity);
  }
});

test("enforces exactly nine own JSON keys, including explicit nullable fields", () => {
  assert.equal(isRejected({unexpected: "payload"}), true);
  assert.equal(isRejected({providerTemplateId: undefined}), true);
  assert.equal(isRejected({reasonCode: undefined}), true);
  assert.equal(isRejected({providerTemplateId: null, reasonCode: null}), false);
  for (const key of expectedKeys) {
    const missing: Record<string, unknown> = {...fixture.observation};
    delete missing[key];
    assert.equal(MetaTemplateStatusObservationV2Schema.safeParse(missing).success, false, `missing ${key}`);
  }
  const inherited = Object.assign(Object.create({wabaId: "123456789"}) as Record<string, unknown>, {...fixture.observation});
  assert.equal(Reflect.deleteProperty(inherited, "wabaId"), true);
  assert.equal(MetaTemplateStatusObservationV2Schema.safeParse(inherited).success, false);
  assert.equal(MetaTemplateStatusObservationV2Schema.safeParse([]).success, false);
});

test("rejects numeric, unsafe and improperly bounded provider IDs", () => {
  for (const input of [123, 0, 12345678901234567000, "", " 123", "123 ", "+123", "-1", "01.1", "12e3", "123?shop=other", "abc", "9".repeat(33)]) {
    assert.equal(isRejected({wabaId: input}), true);
    assert.equal(isRejected({providerTemplateId: input}), true);
  }
  assert.equal(isRejected({wabaId: "9".repeat(32), providerTemplateId: "0"}), false);
});

test("rejects wrong versions, UUIDs, null required fields and provider string limits", () => {
  for (const version of [1, "2", 3, null]) assert.equal(isRejected({schemaVersion: version}), true);
  for (const identity of ["", primaryUuid, "meta-template-status:v1:" + primaryUuid, "meta-template-status:v2:" + primaryUuid.toUpperCase(), "meta-template-status:v2:550e8400-e29b-51d4-a716-446655440000"]) {
    assert.equal(isRejected({eventIdentity: identity}), true);
  }
  for (const field of ["eventIdentity", "wabaId", "providerTemplateName", "providerLanguageCode", "providerStatus", "receivedAt"]) {
    assert.equal(isRejected({[field]: null}), true, `${field} must not be null`);
  }
  for (const [field, max] of [["providerTemplateName",255],["providerLanguageCode",16],["providerStatus",32],["reasonCode",128]] as const) {
    assert.equal(isRejected({[field]: ""}), true);
    assert.equal(isRejected({[field]: " ".repeat(2)}), true);
    assert.equal(isRejected({[field]: "x".repeat(max+1)}), true);
    assert.equal(isRejected({[field]: "line\nbreak"}), true);
  }
});

test("UTC receipt is canonical and calendar-valid, not a provider ordering key", () => {
  for (const receivedAt of [
    "2026-10-25T19:00:00Z", "2026-10-25T19:00:00.0Z",
    "2026-10-25T19:00:00.000+00:00", "2026-10-25T19:00:00.000+01:00",
    "2026-02-29T19:00:00.000Z", "2026-13-25T19:00:00.000Z",
    "2026-10-32T19:00:00.000Z", "2026-10-25T25:00:00.000Z",
    "2026-10-25T19:61:00.000Z", "2026-10-25T19:00:60.000Z",
  ]) assert.equal(isRejected({receivedAt}), true, receivedAt);
  assert.equal(isRejected({receivedAt: "2024-02-29T00:00:00.000Z"}), false);
  assert.equal(isRejected({receivedAt: "2025-10-25T19:00:00.000Z"}), false);
});

test("accepts unknown well-formed status text without normalising or inferring approval", () => {
  for (const status of ["APPROVED", "PAUSED", "REJECTED", "PENDING", "NEVER_SEEN_BEFORE", "CaseSensitive_Future"]) {
    assert.equal(MetaTemplateStatusObservationV2Schema.parse({...fixture.observation,providerStatus:status}).providerStatus, status);
  }
  assert.equal(MetaTemplateStatusObservationV2Schema.parse({...fixture.observation,providerLanguageCode:"EN_gb"}).providerLanguageCode, "EN_gb");
});

test("enforces the 4096-byte JSON bound even before typed field validation", () => {
  const oversized = {...fixture.observation,providerTemplateName:"\u0000".repeat(800)};
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > 4096);
  const result = MetaTemplateStatusObservationV2Schema.safeParse(oversized);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some(({message}) => message.includes("4096 UTF-8 bytes")));
    assert.ok(result.error.issues.every(({message}) => !message.includes("\u0000".repeat(10))));
  }
  const circular: Record<string, unknown> = {...fixture.observation};
  circular.circular = circular;
  assert.equal(MetaTemplateStatusObservationV2Schema.safeParse(circular).success, false);
});
