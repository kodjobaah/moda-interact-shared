import { z } from "zod";

export const MERCHANT_KNOWLEDGE_PURPOSE_KEYS = [
  "COMPANY_INFORMATION",
  "CUSTOMER_SUPPORT",
  "POLICIES",
  "FAQ",
  "PRODUCT_INFORMATION",
  "SHIPPING_AND_DELIVERY",
  "PRICING",
] as const;

export const MerchantKnowledgePurposeKeySchema = z.enum(
  MERCHANT_KNOWLEDGE_PURPOSE_KEYS,
);

export type MerchantKnowledgePurposeKey =
  z.infer<typeof MerchantKnowledgePurposeKeySchema>;

export const MERCHANT_KNOWLEDGE_DATA_FORMAT_KEYS = [
  "WEB_PAGE",
  "CSV",
  "XLSX",
] as const;

export const MerchantKnowledgeDataFormatKeySchema = z.enum(
  MERCHANT_KNOWLEDGE_DATA_FORMAT_KEYS,
);

export type MerchantKnowledgeDataFormatKey =
  z.infer<typeof MerchantKnowledgeDataFormatKeySchema>;

export const MERCHANT_KNOWLEDGE_FEATURE_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export const MerchantKnowledgeAllowedSourceTypeSchema = z
  .object({
    purposeKey: MerchantKnowledgePurposeKeySchema,
    dataFormatKey: MerchantKnowledgeDataFormatKeySchema,
  })
  .strict();

export type MerchantKnowledgeAllowedSourceType =
  z.infer<typeof MerchantKnowledgeAllowedSourceTypeSchema>;

export const MerchantKnowledgeFeatureConfigurationSchema = z
  .object({
    schemaVersion: z.literal(
      MERCHANT_KNOWLEDGE_FEATURE_CONFIGURATION_SCHEMA_VERSION,
    ),
    maxKnowledgeSources: z.number().int().min(1).max(100),
    maxContentUnitsPerSource: z.number().int().min(1).max(25000),
    allowedSourceTypes: z
      .array(MerchantKnowledgeAllowedSourceTypeSchema)
      .max(100),
  })
  .strict()
  .superRefine(({ allowedSourceTypes }, context) => {
    const pairs = new Set<string>();
    for (const sourceType of allowedSourceTypes) {
      const pair = `${sourceType.purposeKey}\u001f${sourceType.dataFormatKey}`;
      if (pairs.has(pair)) {
        context.addIssue({
          code: "custom",
          message: "allowedSourceTypes must not contain duplicate pairs",
          path: ["allowedSourceTypes"],
        });
        return;
      }
      pairs.add(pair);
    }
  });

export type MerchantKnowledgeFeatureConfiguration =
  z.infer<typeof MerchantKnowledgeFeatureConfigurationSchema>;

export const MERCHANT_KNOWLEDGE_QUEUE_NAME = "merchant-knowledge" as const;
export const MERCHANT_KNOWLEDGE_PROCESS_JOB_NAME =
  "process-source-revision" as const;
export const MERCHANT_KNOWLEDGE_PROCESS_SCHEMA_VERSION = 1 as const;

export const MerchantKnowledgeProcessSourceRevisionJobSchema = z
  .object({
    schemaVersion: z.literal(MERCHANT_KNOWLEDGE_PROCESS_SCHEMA_VERSION),
    shopId: z.string().trim().min(1).max(128),
    sourceRevisionId: z.string().trim().min(1).max(128),
    generation: z.number().int().positive(),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type MerchantKnowledgeProcessSourceRevisionJob =
  z.infer<typeof MerchantKnowledgeProcessSourceRevisionJobSchema>;
