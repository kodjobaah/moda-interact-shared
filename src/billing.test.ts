import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_PLAN_KINDS,
  BILLING_SYSTEM_MESSAGE_CODES,
  BILLING_USAGE_METRICS,
  BillingPlanKindSchema,
  BillingSystemMessageCodeSchema,
  BillingUsageMetricSchema,
  type BillingSystemMessageCode,
  NormalizedWhatsAppStatusSchema,
  WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION,
  createMerchantBillingSystemSourceKey,
  createRecoveryIdempotencyKey,
  createShopifyUsageIdempotencyKey,
  parseNormalizedWhatsAppStatus,
} from "./billing.js";

type Assert<T extends true> = T;
type BillingSystemMessageCodeDoesNotWiden = string extends BillingSystemMessageCode ? false : true;
type BillingSystemMessageCodeTypeAssertion = Assert<BillingSystemMessageCodeDoesNotWiden>;

function validStatus() {
  return {
    schemaVersion: WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION,
    providerAccountId: "meta-account-123",
    providerPhoneNumberId: "meta-phone-123",
    providerMessageId: "wamid.message-123",
    status: "DELIVERED" as const,
    occurredAt: "2026-09-07T18:00:00.000Z",
    pricing: { billable: true, category: "utility", model: "CBP" },
  };
}

test("exports canonical billing values", () => {
  assert.deepEqual(BillingPlanKindSchema.options, BILLING_PLAN_KINDS);
  assert.deepEqual(BillingUsageMetricSchema.options, BILLING_USAGE_METRICS);
  assert.deepEqual(BILLING_USAGE_METRICS, [
    "RECOVERY_CONVERSATION",
    "OUTBOUND_AUTOMATED_MESSAGE",
    "DELIVERED_WHATSAPP_MESSAGE",
    "RECOVERY_CREDIT_PACK_PURCHASE",
  ]);
  assert.deepEqual(Object.values(BILLING_SYSTEM_MESSAGE_CODES), [
    "BILLING_FREE_ALLOWANCE_WARNING",
    "BILLING_FREE_ALLOWANCE_EXHAUSTED",
    "BILLING_PLAN_UPGRADED",
    "BILLING_PLAN_DOWNGRADE_SCHEDULED",
    "BILLING_SUBSCRIPTION_ENDED",
    "BILLING_SAFETY_LIMIT_REACHED",
  ]);
  assert.equal(BillingSystemMessageCodeSchema.parse("BILLING_PLAN_UPGRADED"), "BILLING_PLAN_UPGRADED");
  assert.equal(
    BillingUsageMetricSchema.parse("RECOVERY_CREDIT_PACK_PURCHASE"),
    "RECOVERY_CREDIT_PACK_PURCHASE",
  );
});

test("parses a normalized provider status with bounded pricing metadata", () => {
  assert.deepEqual(parseNormalizedWhatsAppStatus(validStatus()), validStatus());
});

test("rejects malformed provider status identity, timestamp, status, metadata, and extra fields", () => {
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), schemaVersion: 1 }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerAccountId: "" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerAccountId: "   " }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerAccountId: "a".repeat(129) }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerPhoneNumberId: "" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerPhoneNumberId: "   " }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerPhoneNumberId: "a".repeat(129) }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerMessageId: "" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerMessageId: "   " }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), providerMessageId: "a".repeat(129) }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), shopId: "gid://shopify/Shop/123" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), occurredAt: "not-a-date" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), status: "QUEUED" }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), pricing: { category: "x".repeat(129) } }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), customer: { phone: "+123" } }).success, false);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), pricing: {} }).success, false);
});

test("accepts every provider status literal and optional bounded pricing", () => {
  for (const status of ["SENT", "DELIVERED", "READ", "FAILED"] as const) {
    assert.equal(NormalizedWhatsAppStatusSchema.safeParse({ ...validStatus(), status }).success, true);
  }
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({
    ...validStatus(),
    pricing: undefined,
  }).success, true);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({
    ...validStatus(),
    pricing: { billable: false },
  }).success, true);
  assert.equal(NormalizedWhatsAppStatusSchema.safeParse({
    ...validStatus(),
    pricing: { amount: "1.00" },
  }).success, false);
});

test("creates lifecycle-scoped deterministic billing identities", () => {
  const sourceKey = createMerchantBillingSystemSourceKey(
    "shop-1",
    "BILLING_PLAN_UPGRADED",
    "subscription-transition-1",
  );
  assert.equal(
    sourceKey,
    createMerchantBillingSystemSourceKey(
      "shop-1",
      "BILLING_PLAN_UPGRADED",
      "subscription-transition-1",
    ),
  );
  assert.equal(
    sourceKey,
    "billing-system:shop-1:BILLING_PLAN_UPGRADED:subscription-transition-1:1",
  );
  assert.notEqual(
    sourceKey,
    createMerchantBillingSystemSourceKey(
      "shop-1",
      "BILLING_PLAN_UPGRADED",
      "subscription-transition-2",
    ),
  );
  assert.notEqual(
    sourceKey,
    createMerchantBillingSystemSourceKey(
      "shop-1",
      "BILLING_PLAN_UPGRADED",
      "subscription-transition-1",
      2,
    ),
  );

  const recoveryKey = createRecoveryIdempotencyKey("shop-1", "recovery-1");
  assert.equal(recoveryKey, "recovery:shop-1:recovery-1");

  const longEventIdentity = "event-" + "x".repeat(300);
  const boundedSourceKey = createMerchantBillingSystemSourceKey(
    "shop-1",
    "BILLING_PLAN_UPGRADED",
    longEventIdentity,
  );
  assert.equal(boundedSourceKey, createMerchantBillingSystemSourceKey(
    "shop-1",
    "BILLING_PLAN_UPGRADED",
    longEventIdentity,
  ));
  assert.ok(boundedSourceKey.length <= 255);

  const shopifyKey = createShopifyUsageIdempotencyKey("s".repeat(300), "u".repeat(300));
  assert.equal(shopifyKey, createShopifyUsageIdempotencyKey("s".repeat(300), "u".repeat(300)));
  assert.ok(shopifyKey.length <= 64);
});

test("rejects empty identity key parts", () => {
  assert.throws(() => createMerchantBillingSystemSourceKey(
    "shop-1",
    "BILLING_PLAN_UPGRADED",
    "",
  ));
  assert.throws(() => createMerchantBillingSystemSourceKey(
    "shop-1",
    "BILLING_PLAN_UPGRADED",
    "   ",
  ));
  assert.throws(() => createRecoveryIdempotencyKey("", "recovery-1"));
  assert.throws(() => createShopifyUsageIdempotencyKey("shop-1", ""));
});