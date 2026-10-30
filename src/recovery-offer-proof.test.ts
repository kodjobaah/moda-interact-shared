import assert from "node:assert/strict";
import test from "node:test";
import { commerceToolResultSchema } from "./commerce/schemas";
import {
  RecoveryDiscountProofRequestSchema,
  RecoveryDiscountProofResultSchema,
  type RecoveryDiscountProofRequest,
  type RecoveryDiscountProofResult,
} from "./recovery-offer-proof";

const identity = {
  schemaVersion: 1 as const,
  shopId: "shop_123",
  checkoutRecoveryId: "recovery_456",
  outreachAttemptId: "attempt_789",
  catalogueDiscountId: "discount_123",
  providerDiscountId: "provider_123",
  checkoutFingerprint: "a".repeat(64),
};

const checkoutRequest = {
  ...identity,
  target: { kind: "CHECKOUT" as const },
} satisfies RecoveryDiscountProofRequest;

const alternativeRequest = {
  ...identity,
  target: {
    kind: "ALTERNATIVE_PRODUCT" as const,
    productId: "product_123",
    variantId: null,
  },
} satisfies RecoveryDiscountProofRequest;

const eligibleProof = {
  ...checkoutRequest,
  checkedAt: "2026-10-29T18:00:00.000Z",
  outcome: "eligible" as const,
  method: "CODE" as const,
  code: "RUN20",
  verifiedDescription: "20% off running shoes",
  currency: "GBP",
  savings: "20.00",
  expiresAt: "2026-10-29T18:01:00.000Z",
  verifiedConditions: ["PRODUCT_MATCH"],
} satisfies RecoveryDiscountProofResult;

const unsupportedProof = {
  ...alternativeRequest,
  checkedAt: "2026-10-29T18:00:00.000Z",
  outcome: "unsupported" as const,
  reasonCodes: ["PROVIDER_RESTRICTION_UNKNOWN"],
} satisfies RecoveryDiscountProofResult;

test("discount proof accepts checkout and alternative-product requests", () => {
  assert.equal(RecoveryDiscountProofRequestSchema.safeParse(checkoutRequest).success, true);
  assert.equal(RecoveryDiscountProofRequestSchema.safeParse(alternativeRequest).success, true);
});

test("discount proof accepts eligible and non-eligible result branches", () => {
  assert.equal(RecoveryDiscountProofResultSchema.safeParse(eligibleProof).success, true);
  assert.equal(RecoveryDiscountProofResultSchema.safeParse(unsupportedProof).success, true);

  const successEnvelope = commerceToolResultSchema(RecoveryDiscountProofResultSchema).safeParse({
    contractVersion: "commerce.v1",
    status: "OK",
    data: eligibleProof,
    renderedText: "Verified discount evidence",
  });
  assert.equal(successEnvelope.success, true);

  const errorEnvelope = commerceToolResultSchema(RecoveryDiscountProofResultSchema).safeParse({
    contractVersion: "commerce.v1",
    status: "ERROR",
    code: "UNAVAILABLE",
    retryable: true,
    renderedText: "Discount evidence is unavailable",
  });
  assert.equal(errorEnvelope.success, true);
});

test("discount proof rejects malformed identity, target, timestamps, and unknown fields", () => {
  const requiredIds = [
    "shopId",
    "checkoutRecoveryId",
    "outreachAttemptId",
    "catalogueDiscountId",
    "providerDiscountId",
  ] as const;
  const invalidRequests: unknown[] = [
    { ...checkoutRequest, unexpected: true },
    { ...checkoutRequest, target: { kind: "OTHER" } },
    { ...checkoutRequest, target: { kind: "ALTERNATIVE_PRODUCT", variantId: null } },
    { ...checkoutRequest, checkoutFingerprint: "not-a-hash" },
  ];
  for (const id of requiredIds) {
    const { [id]: _missing, ...missingId } = checkoutRequest;
    invalidRequests.push(missingId);
  }
  for (const value of invalidRequests) {
    assert.equal(RecoveryDiscountProofRequestSchema.safeParse(value).success, false);
  }

  const { checkedAt: _checkedAt, ...missingTimestamp } = eligibleProof;
  assert.equal(RecoveryDiscountProofResultSchema.safeParse(missingTimestamp).success, false);
  assert.equal(
    RecoveryDiscountProofResultSchema.safeParse({ ...eligibleProof, unexpected: true }).success,
    false,
  );
});
