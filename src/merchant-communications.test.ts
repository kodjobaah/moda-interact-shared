import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthoredSupportBodySchema,
  MerchantMessageTranslationContractSchema,
  MerchantSupportMessageKindSchema,
  MerchantSupportMessageStateSchema,
  MerchantTranslationDirectionSchema,
  MerchantTranslationBatchStatusSchema,
  MerchantMessageTranslationStatusSchema,
  MerchantTranslationReconciliationScopeSchema,
  MerchantTranslationReconciliationStatusSchema,
  MERCHANT_COMMUNICATIONS_JOB_NAMES,
  TranslationBatchPollJobSchema,
  TranslationDispatchJobSchema,
  TranslatedSupportBodySchema,
  countUnicodeGraphemes,
  requiresMerchantTranslation,
} from "./merchant-communications.js";

test("aligns shared values with DATABASE-002", () => {
  assert.deepEqual(MerchantSupportMessageKindSchema.options, [
    "ADMINISTRATIVE",
    "SYSTEM",
    "MERCHANT",
  ]);
  assert.deepEqual(MerchantSupportMessageStateSchema.options, [
    "PROCESSING",
    "AVAILABLE",
    "FAILED",
  ]);
  assert.deepEqual(MerchantTranslationDirectionSchema.options, [
    "MERCHANT_TO_ADMIN",
    "ADMIN_TO_MERCHANT",
    "SYSTEM_TO_MERCHANT",
  ]);
  assert.deepEqual(MerchantMessageTranslationStatusSchema.options, [
    "PENDING",
    "AVAILABLE",
    "FAILED",
  ]);
  assert.deepEqual(MerchantTranslationBatchStatusSchema.options, [
    "READY",
    "SUBMITTING",
    "SUBMISSION_UNKNOWN",
    "SUBMITTED",
    "PROVIDER_COMPLETED",
    "COMPLETED",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
  ]);
  assert.deepEqual(MerchantTranslationReconciliationScopeSchema.options, [
    "TRANSLATION",
    "FAILED_TRANSLATIONS",
  ]);
  assert.deepEqual(MerchantTranslationReconciliationStatusSchema.options, [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
  ]);
});

test("counts Unicode grapheme clusters rather than UTF-16 code units", () => {
  assert.equal(countUnicodeGraphemes("👩‍💻"), 1);
  assert.equal(countUnicodeGraphemes("e\u0301"), 1);
  assert.equal(countUnicodeGraphemes("😀"), 1);
  assert.equal(AuthoredSupportBodySchema.safeParse("👩‍💻".repeat(500)).success, true);
  assert.equal(AuthoredSupportBodySchema.safeParse("👩‍💻".repeat(501)).success, false);
  assert.equal(AuthoredSupportBodySchema.safeParse("").success, false);
});

test("translated output is not limited by the authored-body cap", () => {
  const translatedBody = "x".repeat(501);
  assert.equal(TranslatedSupportBodySchema.parse(translatedBody), translatedBody);
  assert.equal(MerchantMessageTranslationContractSchema.parse({
    direction: "ADMIN_TO_MERCHANT",
    sourceLanguageTag: "en-GB",
    targetLanguageTag: "de-DE",
    status: "AVAILABLE",
    translatedBody,
  }).translatedBody, translatedBody);
});

test("routes by canonical primary language", () => {
  assert.equal(requiresMerchantTranslation("en-US", "en-GB"), false);
  assert.equal(requiresMerchantTranslation("en-CA", "en-GB"), false);
  assert.equal(requiresMerchantTranslation("en-GB", "fr-FR"), true);
  assert.equal(requiresMerchantTranslation("fr-FR", "en-GB"), true);
});

test("queue payload schemas are strict and contain only durable identifiers", () => {
  assert.deepEqual(Object.values(MERCHANT_COMMUNICATIONS_JOB_NAMES), [
    "translation-dispatch",
    "translation-batch-submit",
    "translation-batch-poll",
    "translation-batch-results",
    "translation-reconcile",
  ]);
  assert.deepEqual(TranslationDispatchJobSchema.parse({
    schemaVersion: 1,
    translationId: "translation-1",
  }), {
    schemaVersion: 1,
    translationId: "translation-1",
  });
  assert.equal(TranslationDispatchJobSchema.safeParse({
    schemaVersion: 1,
    translationId: "translation-1",
    body: "secret text",
  }).success, false);
  assert.equal(TranslationBatchPollJobSchema.safeParse({
    schemaVersion: 1,
    translationBatchId: "batch-1",
    pollSequence: 2,
    shopId: "shop-1",
  }).success, false);
});