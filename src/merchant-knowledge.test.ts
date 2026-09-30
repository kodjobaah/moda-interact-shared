import assert from "node:assert/strict";
import test from "node:test";

import {
  MERCHANT_KNOWLEDGE_DATA_FORMAT_KEYS,
  MERCHANT_KNOWLEDGE_FEATURE_CONFIGURATION_SCHEMA_VERSION,
  MERCHANT_KNOWLEDGE_PURPOSE_KEYS,
  MerchantKnowledgeAllowedSourceTypeSchema,
  MerchantKnowledgeDataFormatKeySchema,
  MerchantKnowledgeFeatureConfigurationSchema,
  MerchantKnowledgeProcessSourceRevisionJobSchema,
  MerchantKnowledgePurposeKeySchema,
} from "./merchant-knowledge.js";

const configuration = {
  schemaVersion: MERCHANT_KNOWLEDGE_FEATURE_CONFIGURATION_SCHEMA_VERSION,
  maxKnowledgeSources: 5,
  maxContentUnitsPerSource: 1500,
  allowedSourceTypes: [
    { purposeKey: "COMPANY_INFORMATION", dataFormatKey: "WEB_PAGE" },
  ],
};

test("validates the exact Merchant Knowledge Purpose and Data Format identities", () => {
  assert.deepEqual(
    MERCHANT_KNOWLEDGE_PURPOSE_KEYS.map((key) =>
      MerchantKnowledgePurposeKeySchema.parse(key),
    ),
    [...MERCHANT_KNOWLEDGE_PURPOSE_KEYS],
  );
  assert.deepEqual(
    MERCHANT_KNOWLEDGE_DATA_FORMAT_KEYS.map((key) =>
      MerchantKnowledgeDataFormatKeySchema.parse(key),
    ),
    [...MERCHANT_KNOWLEDGE_DATA_FORMAT_KEYS],
  );
  assert.equal(MerchantKnowledgePurposeKeySchema.safeParse("SUPPORT").success, false);
  assert.equal(MerchantKnowledgeDataFormatKeySchema.safeParse("PDF").success, false);
});

test("validates strict plan configuration bounds and allowed source type identities", () => {
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse(configuration).success, true);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, schemaVersion: 2 }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, maxKnowledgeSources: 0 }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, maxKnowledgeSources: 101 }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, maxContentUnitsPerSource: 0 }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, maxContentUnitsPerSource: 25001 }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, extra: true }).success, false);
  assert.equal(MerchantKnowledgeAllowedSourceTypeSchema.safeParse({ ...configuration.allowedSourceTypes[0], extra: true }).success, false);
  assert.equal(MerchantKnowledgeFeatureConfigurationSchema.safeParse({ ...configuration, allowedSourceTypes: [] }).success, true);
});

test("rejects duplicate pairs without embedding the database compatibility matrix", () => {
  assert.equal(
    MerchantKnowledgeFeatureConfigurationSchema.safeParse({
      ...configuration,
      allowedSourceTypes: [
        { purposeKey: "COMPANY_INFORMATION", dataFormatKey: "WEB_PAGE" },
        { purposeKey: "COMPANY_INFORMATION", dataFormatKey: "WEB_PAGE" },
      ],
    }).success,
    false,
  );
  assert.equal(
    MerchantKnowledgeFeatureConfigurationSchema.safeParse({
      ...configuration,
      allowedSourceTypes: [
        { purposeKey: "PRODUCT_INFORMATION", dataFormatKey: "WEB_PAGE" },
        { purposeKey: "PRODUCT_INFORMATION", dataFormatKey: "CSV" },
        { purposeKey: "PRICING", dataFormatKey: "WEB_PAGE" },
      ],
    }).success,
    true,
  );
  assert.equal(
    MerchantKnowledgeFeatureConfigurationSchema.safeParse({
      ...configuration,
      allowedSourceTypes: [
        { purposeKey: "COMPANY_INFORMATION", dataFormatKey: "XLSX" },
      ],
    }).success,
    true,
  );
});

test("validates a strict versioned processing job identity payload", () => {
  const job = {
    schemaVersion: 1,
    shopId: "shop-1",
    sourceRevisionId: "revision-1",
    generation: 1,
    requestedAt: "2026-09-30T07:30:00+02:00",
  };
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse(job).success, true);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, extra: true }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, requestedAt: "2026-09-30" }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, requestedAt: "2026-09-30T07:30:00" }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, schemaVersion: 2 }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, shopId: "  " }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, sourceRevisionId: "x".repeat(129) }).success, false);
  assert.equal(MerchantKnowledgeProcessSourceRevisionJobSchema.safeParse({ ...job, generation: 0 }).success, false);
});
