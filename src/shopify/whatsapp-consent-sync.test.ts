import assert from "node:assert/strict";
import { test } from "node:test";
import { SHOPIFY_WEBHOOK_QUEUE_CONTRACTS } from "./queue-contracts.js";
import { parseShopifyRecoveryEvent } from "./recovery-event.schema.js";
import { parseShopifyCommerceEvent } from "./v1/commerce-event.schema.js";
import {
  SHOPIFY_WHATSAPP_CONSENT_SYNC_SCHEMA_VERSION,
  SHOPIFY_WHATSAPP_CONSENT_SYNC_TOPIC,
  parseShopifyWhatsAppConsentSyncJobV1,
  safeParseShopifyWhatsAppConsentSyncJobV1,
} from "./whatsapp-consent-sync.schema.js";
import { createShopifyWhatsAppConsentSyncJobId } from "./node.js";

const validJob = () => ({
  schemaVersion: SHOPIFY_WHATSAPP_CONSENT_SYNC_SCHEMA_VERSION,
  shopId: "shop_123",
  shopifyCustomerId: "1234567890123",
  deliveryId: "delivery_123",
  triggeredAt: "2026-10-21T17:00:00.000Z",
});

test("consent sync contains only the versioned, bounded notification fields", () => {
  const parsed = parseShopifyWhatsAppConsentSyncJobV1(validJob());
  assert.deepEqual(Object.keys(parsed).sort(), [
    "schemaVersion", "shopId", "shopifyCustomerId", "deliveryId", "triggeredAt",
  ].sort());
  assert.equal(SHOPIFY_WHATSAPP_CONSENT_SYNC_TOPIC,
    "customers_whats_app_marketing_consent/update");
});

test("sync payload rejects authority, customer PII, checkout and recovery fields", () => {
  for (const field of [
    "phone", "consent", "consentGranted", "checkoutToken", "checkoutKey",
    "recoveryId", "startRecovery", "scheduleRecovery", "shopDomain", "eventType",
  ]) {
    assert.equal(safeParseShopifyWhatsAppConsentSyncJobV1({
      ...validJob(), [field]: field === "consent" ? true : "not-allowed",
    }).success, false, field);
  }
});

test("sync payload rejects malformed source/version/customer and unsafe timestamps", () => {
  const valid = validJob();
  for (const invalid of [
    { ...valid, schemaVersion: 2 },
    { ...valid, shopId: " " },
    { ...valid, shopId: "x".repeat(129) },
    { ...valid, deliveryId: " " },
    { ...valid, deliveryId: "x".repeat(257) },
    { ...valid, shopifyCustomerId: "gid://shopify/Customer/1234567890123" },
    { ...valid, shopifyCustomerId: "gid://shopify/Order/123" },
    { ...valid, shopifyCustomerId: "0" },
    { ...valid, shopifyCustomerId: "9223372036854775808" },
    { ...valid, shopifyCustomerId: 1234567890123 },
    { ...valid, triggeredAt: "yesterday" },
  ]) {
    assert.equal(safeParseShopifyWhatsAppConsentSyncJobV1(invalid).success, false,
      JSON.stringify(invalid));
  }
});

test("sync job is distinct from existing checkout and order event parsers", () => {
  const job = validJob();
  assert.throws(() => parseShopifyRecoveryEvent(job));
  assert.throws(() => parseShopifyCommerceEvent(job));
  assert.equal(SHOPIFY_WEBHOOK_QUEUE_CONTRACTS.WHATSAPP_CONSENT_SYNC.queueName,
    SHOPIFY_WEBHOOK_QUEUE_CONTRACTS.CHECKOUT_EVENTS.queueName);
  const allJobs = Object.values(SHOPIFY_WEBHOOK_QUEUE_CONTRACTS)
    .filter((contract) => contract.queueName === "checkout-events")
    .map((contract) => contract.jobName);
  assert.equal(allJobs.length, new Set(allJobs).size);
});

test("sync job ID is deterministic on shop + delivery and safe for BullMQ", () => {
  const job = validJob();
  const id = createShopifyWhatsAppConsentSyncJobId(job);
  assert.equal(id, createShopifyWhatsAppConsentSyncJobId({ ...job }));
  assert.match(id, /^shopify-whatsapp-consent-sync-[a-f0-9]{64}$/);
  assert.notEqual(id, createShopifyWhatsAppConsentSyncJobId({
    ...job, shopId: "other_shop",
  }));
  assert.notEqual(id, createShopifyWhatsAppConsentSyncJobId({
    ...job, deliveryId: "different_delivery",
  }));
  assert.equal(id.includes(job.deliveryId), false);
  assert.equal(id.includes(job.shopifyCustomerId), false);
  assert.equal(id.includes(":"), false);
});

test("deduplication is independent of re-read timing and scoped to exact tuple", () => {
  const job = validJob();
  const id = createShopifyWhatsAppConsentSyncJobId(job);
  assert.equal(id, createShopifyWhatsAppConsentSyncJobId({
    ...job, triggeredAt: "2026-10-22T18:00:00Z",
  }));
  const first = { ...job, shopId: "a:b", deliveryId: "c" };
  const second = { ...job, shopId: "a", deliveryId: "b:c" };
  assert.notEqual(createShopifyWhatsAppConsentSyncJobId(first),
    createShopifyWhatsAppConsentSyncJobId(second));
});

test("job ID helper fails closed on invalid/unexpected job data", () => {
  assert.throws(() => createShopifyWhatsAppConsentSyncJobId({
    ...validJob(), phone: "+447700900123",
  } as ReturnType<typeof validJob>));
});
