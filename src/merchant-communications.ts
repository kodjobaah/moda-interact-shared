import { z } from "zod";
import { LanguageTagSchema, canonicaliseLanguageTag } from "./internationalization.js";

export const PLATFORM_SUPPORT_LANGUAGE_TAG = "en-GB" as const;
export const MERCHANT_COMMUNICATIONS_QUEUE_NAME = "merchant-communications" as const;
export const MERCHANT_COMMUNICATIONS_SCHEMA_VERSION = 1 as const;

export const MerchantSupportMessageKindSchema = z.enum([
  "ADMINISTRATIVE",
  "SYSTEM",
  "MERCHANT",
]);

export const MerchantSupportMessageStateSchema = z.enum([
  "PROCESSING",
  "AVAILABLE",
  "FAILED",
]);

export const MerchantTranslationDirectionSchema = z.enum([
  "MERCHANT_TO_ADMIN",
  "ADMIN_TO_MERCHANT",
  "SYSTEM_TO_MERCHANT",
]);

export const MerchantMessageTranslationStatusSchema = z.enum([
  "PENDING",
  "AVAILABLE",
  "FAILED",
]);

export const MerchantTranslationBatchStatusSchema = z.enum([
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

export const MerchantTranslationReconciliationScopeSchema = z.enum([
  "TRANSLATION",
  "FAILED_TRANSLATIONS",
]);

export const MerchantTranslationReconciliationStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

export type MerchantSupportMessageKind = z.infer<typeof MerchantSupportMessageKindSchema>;
export type MerchantSupportMessageState = z.infer<typeof MerchantSupportMessageStateSchema>;
export type MerchantTranslationDirection = z.infer<typeof MerchantTranslationDirectionSchema>;
export type MerchantMessageTranslationStatus = z.infer<typeof MerchantMessageTranslationStatusSchema>;
export type MerchantTranslationBatchStatus = z.infer<typeof MerchantTranslationBatchStatusSchema>;
export type MerchantTranslationReconciliationScope = z.infer<
  typeof MerchantTranslationReconciliationScopeSchema
>;
export type MerchantTranslationReconciliationStatus = z.infer<
  typeof MerchantTranslationReconciliationStatusSchema
>;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function countUnicodeGraphemes(value: string): number {
  return Array.from(graphemeSegmenter.segment(value)).length;
}

export const AuthoredSupportBodySchema = z.string().refine(
  (value) => {
    const graphemeCount = countUnicodeGraphemes(value);
    return graphemeCount >= 1 && graphemeCount <= 500;
  },
  "Support body must contain 1 to 500 user-perceived characters",
);

export const TranslatedSupportBodySchema = z.string();

export const MerchantSupportMessageContractSchema = z
  .object({
    kind: MerchantSupportMessageKindSchema,
    state: MerchantSupportMessageStateSchema,
    originalBody: AuthoredSupportBodySchema,
    sourceLanguageTag: LanguageTagSchema,
    displayLanguageTag: LanguageTagSchema.nullable(),
  })
  .strict();

export const MerchantMessageTranslationContractSchema = z
  .object({
    direction: MerchantTranslationDirectionSchema,
    sourceLanguageTag: LanguageTagSchema,
    targetLanguageTag: LanguageTagSchema,
    status: MerchantMessageTranslationStatusSchema,
    translatedBody: TranslatedSupportBodySchema.nullable(),
  })
  .strict();

export const MerchantTranslationBatchContractSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    status: MerchantTranslationBatchStatusSchema,
    providerBatchId: z.string().min(1).nullable(),
    inputFileId: z.string().min(1).nullable(),
    outputFileId: z.string().min(1).nullable(),
    errorFileId: z.string().min(1).nullable(),
  })
  .strict();

export const MerchantTranslationReconciliationRequestContractSchema = z
  .object({
    scope: MerchantTranslationReconciliationScopeSchema,
    translationId: z.string().min(1).nullable(),
    status: MerchantTranslationReconciliationStatusSchema,
  })
  .strict();

export type MerchantSupportMessageContract = z.infer<typeof MerchantSupportMessageContractSchema>;
export type MerchantMessageTranslationContract = z.infer<
  typeof MerchantMessageTranslationContractSchema
>;
export type MerchantTranslationBatchContract = z.infer<typeof MerchantTranslationBatchContractSchema>;
export type MerchantTranslationReconciliationRequestContract = z.infer<
  typeof MerchantTranslationReconciliationRequestContractSchema
>;

export function requiresMerchantTranslation(
  sourceLanguageTag: string,
  targetLanguageTag: string,
): boolean {
  const sourceLanguage = new Intl.Locale(canonicaliseLanguageTag(sourceLanguageTag)).language;
  const targetLanguage = new Intl.Locale(canonicaliseLanguageTag(targetLanguageTag)).language;
  return sourceLanguage !== targetLanguage;
}

export const TranslationDispatchJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_COMMUNICATIONS_SCHEMA_VERSION),
    translationId: z.string().min(1),
  })
  .strict();

export const TranslationBatchSubmitJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_COMMUNICATIONS_SCHEMA_VERSION),
    translationBatchId: z.string().min(1),
  })
  .strict();

export const TranslationBatchPollJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_COMMUNICATIONS_SCHEMA_VERSION),
    translationBatchId: z.string().min(1),
    pollSequence: z.number().int().nonnegative(),
  })
  .strict();

export const TranslationBatchResultsJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_COMMUNICATIONS_SCHEMA_VERSION),
    translationBatchId: z.string().min(1),
  })
  .strict();

export const TranslationReconcileJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_COMMUNICATIONS_SCHEMA_VERSION),
    reconciliationRequestId: z.string().min(1).optional(),
  })
  .strict();

export const MERCHANT_COMMUNICATIONS_JOB_NAMES = {
  TRANSLATION_DISPATCH: "translation-dispatch",
  TRANSLATION_BATCH_SUBMIT: "translation-batch-submit",
  TRANSLATION_BATCH_POLL: "translation-batch-poll",
  TRANSLATION_BATCH_RESULTS: "translation-batch-results",
  TRANSLATION_RECONCILE: "translation-reconcile",
} as const;

export type TranslationDispatchJob = z.infer<typeof TranslationDispatchJobSchema>;
export type TranslationBatchSubmitJob = z.infer<typeof TranslationBatchSubmitJobSchema>;
export type TranslationBatchPollJob = z.infer<typeof TranslationBatchPollJobSchema>;
export type TranslationBatchResultsJob = z.infer<typeof TranslationBatchResultsJobSchema>;
export type TranslationReconcileJob = z.infer<typeof TranslationReconcileJobSchema>;