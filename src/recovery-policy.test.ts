import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECOVERY_OFFER_MODES,
  RecoveryOfferModeSchema,
  parseEffectiveRecoveryPolicy,
  safeParseEffectiveRecoveryPolicy,
} from "./recovery-policy.js";

test("every RecoveryOfferMode parses", () => {
  for (const value of RECOVERY_OFFER_MODES) {
    assert.equal(RecoveryOfferModeSchema.parse(value), value);
  }
});

test("invalid enum is rejected", () => {
  assert.throws(() => RecoveryOfferModeSchema.parse("UNKNOWN"));
});

test("FIXED requires a non-empty discount ID", () => {
  assert.throws(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "FIXED",
    fixedShopifyDiscountId: "",
    followUpEnabled: false,
    followUpDelayMinutes: null,
    source: "MERCHANT",
  }));

  assert.doesNotThrow(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "FIXED",
    fixedShopifyDiscountId: "discount_123",
    followUpEnabled: false,
    followUpDelayMinutes: null,
    source: "ADMIN_OVERRIDE",
  }));
});

test("non-FIXED rejects a discount ID", () => {
  assert.throws(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: "discount_123",
    followUpEnabled: false,
    followUpDelayMinutes: null,
    source: "MERCHANT",
  }));
});

test("enabled follow-up requires a valid delay", () => {
  assert.throws(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: null,
    followUpEnabled: true,
    followUpDelayMinutes: null,
    source: "MERCHANT",
  }));

  assert.doesNotThrow(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: null,
    followUpEnabled: true,
    followUpDelayMinutes: 45,
    source: "MERCHANT",
  }));
});

test("disabled follow-up requires null delay", () => {
  assert.throws(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: null,
    followUpEnabled: false,
    followUpDelayMinutes: 45,
    source: "MERCHANT",
  }));

  assert.doesNotThrow(() => parseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: null,
    followUpEnabled: false,
    followUpDelayMinutes: null,
    source: "MERCHANT",
  }));
});

test("safe parse returns a structured result", () => {
  const result = safeParseEffectiveRecoveryPolicy({
    recoveryDelayMinutes: 30,
    recoveryOfferMode: "NONE",
    fixedShopifyDiscountId: null,
    followUpEnabled: false,
    followUpDelayMinutes: null,
    source: "MERCHANT",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.recoveryOfferMode, "NONE");
  }
});
