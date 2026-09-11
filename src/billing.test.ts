import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_PLAN_KINDS,
  BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME,
  BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME,
  BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION,
  APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS,
  BILLING_SYSTEM_MESSAGE_CODES,
  BILLING_USAGE_METRICS,
  BillingPlanKindSchema,
  BillingSystemMessageCodeSchema,
  BillingUsageMetricSchema,
  SHOPIFY_SUBSCRIPTION_CANCELLATION_ARGS,
  SUBSCRIPTION_CANCELLATION_MODES,
  SubscriptionCancellationModeSchema,
  type BillingSystemMessageCode,
  NormalizedWhatsAppStatusSchema,
  WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION,
  availablePurchasedRecoveryCredits,
  createMerchantBillingSystemSourceKey,
  createBillingSubscriptionReconcileJobId,
  createRecoveryIdempotencyKey,
  createShopifyUsageIdempotencyKey,
  parseNormalizedWhatsAppStatus,
  parseBillingSubscriptionReconcileJob,
  safeParseBillingSubscriptionReconcileJob,
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
    "BILLING_RECOVERY_CAPACITY_EXHAUSTED",
    "BILLING_PLAN_UPGRADED",
    "BILLING_PLAN_DOWNGRADE_SCHEDULED",
    "BILLING_SUBSCRIPTION_ENDED",
    "BILLING_SAFETY_LIMIT_REACHED",
    "BILLING_PLAN_CHANGE_ACTION_REQUIRED",
    "BILLING_CANCELLATION_REQUEST_RECEIVED",
    "BILLING_CANCELLATION_COMPLETED",
    "BILLING_CANCELLATION_REJECTED",
    "BILLING_REFUND_REQUEST_RECEIVED",
    "BILLING_REFUND_COMPLETED",
    "BILLING_REFUND_REJECTED",
  ]);
  assert.equal(
    BILLING_SYSTEM_MESSAGE_CODES.RECOVERY_CAPACITY_EXHAUSTED,
    BillingSystemMessageCodeSchema.parse("BILLING_RECOVERY_CAPACITY_EXHAUSTED"),
  );
  assert.equal(BillingSystemMessageCodeSchema.parse("BILLING_PLAN_UPGRADED"), "BILLING_PLAN_UPGRADED");
  assert.equal(
    BillingSystemMessageCodeSchema.parse("BILLING_FREE_ALLOWANCE_EXHAUSTED"),
    "BILLING_FREE_ALLOWANCE_EXHAUSTED",
  );
  assert.throws(() => BillingSystemMessageCodeSchema.parse("BILLING_UNKNOWN_CODE"));
  assert.equal(
    BillingUsageMetricSchema.parse("RECOVERY_CREDIT_PACK_PURCHASE"),
    "RECOVERY_CREDIT_PACK_PURCHASE",
  );
});

test("exports the subscription reconciliation contract and drain policy", () => {
  assert.equal(BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION, 1);
  assert.equal(BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME, "billing-subscription-reconcile");
  assert.equal(BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME, "reconcile-subscription");
  assert.equal(APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS, 300000);
});

test("parses the strict subscription reconciliation v1 payload", () => {
  const payload = {
    schemaVersion: 1,
    shopId: "shop-1",
    subscriptionId: "subscription-1",
    expectedNextReconcileAt: "2026-09-11T18:00:00+00:00",
  };

  assert.deepEqual(parseBillingSubscriptionReconcileJob(payload), payload);
  assert.equal("APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS" in payload, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob(payload).success, true);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, schemaVersion: 2 }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, schemaVersion: undefined }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob(({ ...payload, shopId: undefined })).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, shopId: "" }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, shopId: "   " }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob(({ ...payload, subscriptionId: undefined })).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, subscriptionId: "" }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, expectedNextReconcileAt: "2026-09-11T18:00:00" }).success, false);
  assert.equal(safeParseBillingSubscriptionReconcileJob({ ...payload, unexpected: true }).success, false);
});

test("creates a deterministic colon-free subscription reconciliation job ID", () => {
  const timestamp = "2026-09-11T18:00:00+00:00";
  const jobId = createBillingSubscriptionReconcileJobId("subscription-1", timestamp);

  assert.equal(jobId, createBillingSubscriptionReconcileJobId("subscription-1", timestamp));
  assert.notEqual(jobId, createBillingSubscriptionReconcileJobId("subscription-1", "2026-09-11T18:05:00+00:00"));
  assert.equal(jobId.includes(":"), false);
  assert.ok(jobId.length <= 128);
  assert.throws(() => createBillingSubscriptionReconcileJobId("", timestamp));
  assert.throws(() => createBillingSubscriptionReconcileJobId("subscription-1", "invalid"));


  const boundedSourceKey = createMerchantBillingSystemSourceKey(
    "shop-" + "x".repeat(300),
    BILLING_SYSTEM_MESSAGE_CODES.REFUND_COMPLETED,
    "refund-" + "y".repeat(300),
  );
  assert.ok(boundedSourceKey.length <= 255);
  assert.equal(
    boundedSourceKey,
    createMerchantBillingSystemSourceKey(
      "shop-" + "x".repeat(300),
      BILLING_SYSTEM_MESSAGE_CODES.REFUND_COMPLETED,
      "refund-" + "y".repeat(300),
    ),
  );
});
test("supports the canonical top-up refund message contracts", () => {
  const refundCodes = [
    BILLING_SYSTEM_MESSAGE_CODES.REFUND_REQUEST_RECEIVED,
    BILLING_SYSTEM_MESSAGE_CODES.REFUND_COMPLETED,
    BILLING_SYSTEM_MESSAGE_CODES.REFUND_REJECTED,
  ] as const;

  assert.deepEqual(refundCodes, [
    "BILLING_REFUND_REQUEST_RECEIVED",
    "BILLING_REFUND_COMPLETED",
    "BILLING_REFUND_REJECTED",
  ]);
  for (const code of refundCodes) {
    assert.equal(BillingSystemMessageCodeSchema.parse(code), code);
  }

  const sourceKeys = refundCodes.map((code) =>
    createMerchantBillingSystemSourceKey("shop-1", code, "refund-1"),
  );
  assert.deepEqual(sourceKeys, [
    "billing-system:shop-1:BILLING_REFUND_REQUEST_RECEIVED:refund-1:1",
    "billing-system:shop-1:BILLING_REFUND_COMPLETED:refund-1:1",
    "billing-system:shop-1:BILLING_REFUND_REJECTED:refund-1:1",
  ]);
  assert.deepEqual(
    sourceKeys,
    refundCodes.map((code) =>
      createMerchantBillingSystemSourceKey("shop-1", code, "refund-1"),
    ),
  );
});

test("exports the exact cancellation modes and Shopify provider mapping", () => {
  assert.deepEqual(SubscriptionCancellationModeSchema.options, SUBSCRIPTION_CANCELLATION_MODES);
  assert.deepEqual(SUBSCRIPTION_CANCELLATION_MODES, [
    "END_OF_CYCLE",
    "IMMEDIATE_NO_PRORATION",
    "IMMEDIATE_PRORATED",
    "IMMEDIATE_SKIP_FINAL_USAGE",
  ]);
  assert.deepEqual(SHOPIFY_SUBSCRIPTION_CANCELLATION_ARGS, {
    END_OF_CYCLE: { deferCancellation: true, prorate: false, skipFinalUsageCharge: false },
    IMMEDIATE_NO_PRORATION: { deferCancellation: false, prorate: false, skipFinalUsageCharge: false },
    IMMEDIATE_PRORATED: { deferCancellation: false, prorate: true, skipFinalUsageCharge: false },
    IMMEDIATE_SKIP_FINAL_USAGE: { deferCancellation: false, prorate: false, skipFinalUsageCharge: true },
  });

  for (const args of Object.values(SHOPIFY_SUBSCRIPTION_CANCELLATION_ARGS)) {
    assert.equal(args.prorate && args.skipFinalUsageCharge, false);
  }
});

test("calculates available purchased recovery credits and rejects invalid counters", () => {
  assert.equal(availablePurchasedRecoveryCredits({
    grantedQuantity: 100,
    committedQuantity: 20,
    reservedQuantity: 10,
    refundingQuantity: 0,
  }), 70);
  assert.equal(availablePurchasedRecoveryCredits({
    grantedQuantity: 100,
    committedQuantity: 20,
    reservedQuantity: 10,
    refundingQuantity: 30,
  }), 40);
  assert.equal(availablePurchasedRecoveryCredits({
    grantedQuantity: 10,
    committedQuantity: 5,
    reservedQuantity: 5,
    refundingQuantity: 5,
  }), 0);
  assert.throws(() => availablePurchasedRecoveryCredits({
    grantedQuantity: -1,
    committedQuantity: 0,
    reservedQuantity: 0,
    refundingQuantity: 0,
  }), /grantedQuantity must be a non-negative integer/);
  assert.throws(() => availablePurchasedRecoveryCredits({
    grantedQuantity: 1.5,
    committedQuantity: 0,
    reservedQuantity: 0,
    refundingQuantity: 0,
  }), /grantedQuantity must be a non-negative integer/);
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