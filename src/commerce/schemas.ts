import { z } from "zod";
import { validRange } from "semver";
import {
  ContractVersionSchema as V,
  IdSchema as ID,
  SemverSchema,
  HashSchema,
  DateSchema,
  MoneySchema,
  CurrencySchema,
  distinct,
  boundedJson,
} from "./primitives";
import { GrantedToolsSchema, PublishedToolDescriptorSchema, CommerceBuiltInToolDescriptorSchema, isBuiltInTool, type PublishedGrantedTool } from "./definitions";
import { isTrustedCommerceBuiltInDescriptor, isTrustedCommerceBuiltInGrant } from "./built-in-tools";
import { CommerceResponseContractSchema } from "./response";
import { canonicalJson, jsonBytes } from "./canonical-json";
export const CommerceTurnIdentitySchema = z.strictObject({
  contractVersion: V,
  shopId: ID,
  checkoutRecoveryId: ID,
  conversationId: ID,
  inboundVersion: z.number().int().positive(),
});
export type CommerceTurnIdentity = z.infer<typeof CommerceTurnIdentitySchema>;
export const CommerceConversationGrantSchema = z
  .strictObject({
    id: ID,
    shopId: ID,
    conversationId: ID,
    initialInboundVersion: z.number().int().positive(),
    releaseId: ID,
    selectedCapabilityKeys: z
      .array(ID)
      .max(32)
      .refine(distinct),
    grantedTools: GrantedToolsSchema,
    runnerVersion: SemverSchema,
    createdAt: DateSchema,
    expiresAt: DateSchema.nullable(),
  })
  .superRefine((v, c) => {
    if (v.expiresAt && Date.parse(v.expiresAt) <= Date.parse(v.createdAt))
      c.addIssue({ code: "custom", message: "Invalid grant retention date" });
    if (
      jsonBytes(v.grantedTools) > 65536 ||
      jsonBytes(v.selectedCapabilityKeys) > 8192 ||
      v.grantedTools.some((t) =>
        isBuiltInTool(t) ? !isTrustedCommerceBuiltInGrant(t) : t.capabilityKeys.some((k) => !v.selectedCapabilityKeys.includes(k)),
      )
    )
      c.addIssue({ code: "custom", message: "Unselected grant provenance" });
  });
export type CommerceConversationGrant = z.infer<
  typeof CommerceConversationGrantSchema
>;
export const CommerceManifestSchema = z
  .strictObject({
    contractVersion: V,
    releaseId: ID,
    runnerCompatibility: z
      .string()
      .min(1)
      .max(128)
      .refine((v) => !!validRange(v)),
    capabilities: z
      .array(
        z.strictObject({
          capabilityId: ID,
          key: ID,
          featureId: ID,
          position: z.number().int().nonnegative(),
          toolDescriptor: PublishedToolDescriptorSchema,
        }),
      )
      .max(32),
    featureBehaviours: z
      .array(
        z.strictObject({
          featureId: ID,
          behaviourPrompt: z.string().max(32000),
        }),
      )
      .max(32),
    selectedCapabilityKeys: z.array(ID).max(32).refine(distinct),
    builtInTools: z.array(CommerceBuiltInToolDescriptorSchema).max(2).default([]),
    grantedTools: GrantedToolsSchema,
    responseContract: CommerceResponseContractSchema,
    responseContractHash: HashSchema,
  })
  .superRefine((v, c) => {
    if (jsonBytes(v) > 262144)
      c.addIssue({ code: "custom", message: "Manifest exceeds output limit" });
    const keys = v.capabilities.map((x) => x.key);
    const capabilityIds = v.capabilities.map((x) => x.capabilityId);
    const representedFeatures = [...new Set(v.capabilities.map((x) => x.featureId))];
    const behaviourFeatureIds = v.featureBehaviours.map((x) => x.featureId);
    if (
      !distinct(keys) ||
      !distinct(capabilityIds) ||
      JSON.stringify(keys) !== JSON.stringify(v.selectedCapabilityKeys) ||
      v.capabilities.some(
        (x, i) => i > 0 && x.position <= v.capabilities[i - 1].position,
      ) ||
      !distinct(behaviourFeatureIds) ||
      JSON.stringify(representedFeatures) !== JSON.stringify(behaviourFeatureIds)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid capability ordering/selection",
      });
    const union = new Map<
      string,
      { tool: PublishedGrantedTool; descriptor: string }
    >();
    for (const cap of v.capabilities) {
      const d = cap.toolDescriptor;
      const old = union.get(d.toolId);
      const descriptor = canonicalJson(d);
      if (old) {
        if (old.descriptor !== descriptor)
          c.addIssue({
            code: "custom",
            message: "Conflicting tool revisions/descriptors",
          });
        old.tool.capabilityKeys.push(cap.key);
      } else
        union.set(d.toolId, {
          descriptor,
          tool: {
            toolId: d.toolId,
            toolRevisionId: d.toolRevisionId,
            toolName: d.name,
            definitionVersion: d.definitionVersion,
            capabilityKeys: [cap.key],
          },
        });
    }
    if (
      union.size + v.builtInTools.length !== v.grantedTools.length ||
      !distinct(v.builtInTools.map(tool => tool.name)) ||
      v.builtInTools.some(tool => !isTrustedCommerceBuiltInDescriptor(tool)) ||
      v.grantedTools.some((t) => {
        if (isBuiltInTool(t)) return !v.builtInTools.some(descriptor =>
          descriptor.name === t.toolName && descriptor.definitionVersion === t.definitionVersion &&
          isTrustedCommerceBuiltInGrant(t));
        const expected = union.get(t.toolId)?.tool;
        return (
          !expected ||
          expected.toolRevisionId !== t.toolRevisionId ||
          expected.toolName !== t.toolName ||
          expected.definitionVersion !== t.definitionVersion ||
          JSON.stringify([...new Set(expected.capabilityKeys)].sort()) !==
            JSON.stringify(t.capabilityKeys)
        );
      })
    )
      c.addIssue({
        code: "custom",
        message: "Grant must equal selected capability set",
      });
  });
export type CommerceManifest = z.infer<typeof CommerceManifestSchema>;
export const CommerceReleaseIdentitySchema = z.strictObject({
  contractVersion: V,
  releaseId: ID,
  runnerCompatibility: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => !!validRange(v)),
});
export const CommerceResolveAssertionSchema = CommerceTurnIdentitySchema.extend(
  { purpose: z.literal("resolve") },
);
export const CommerceExecuteAssertionSchema = CommerceTurnIdentitySchema.extend(
  { purpose: z.literal("execute"), grantId: ID, releaseId: ID },
);
export const CommerceAssertionSchema = z.discriminatedUnion("purpose", [
  CommerceResolveAssertionSchema,
  CommerceExecuteAssertionSchema,
]);
const qty = z.number().int().min(1).max(999);
export const CommerceProposalSchema = z
  .strictObject({
    operations: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("ADD"),
            variantId: ID,
            quantity: qty,
          }),
          z.strictObject({
            kind: z.literal("REPLACE"),
            lineId: ID,
            variantId: ID,
            quantity: qty,
          }),
        ]),
      )
      .min(1)
      .max(3),
  })
  .refine((v) =>
    distinct(
      v.operations.flatMap((o) => (o.kind === "REPLACE" ? [o.lineId] : [])),
    ),
  );
export const CommerceBasketSchema = z
  .strictObject({
    basketId: ID,
    source: z.enum(["RECOVERY_SNAPSHOT", "PROPOSED"]),
    observedAt: DateSchema,
    currency: CurrencySchema.nullable(),
    lines: z
      .array(
        z.strictObject({
          lineId: ID,
          productId: ID.nullable(),
          variantId: ID.nullable(),
          quantity: qty.nullable(),
          unitPrice: MoneySchema.nullable(),
        }),
      )
      .max(100),
    fingerprint: HashSchema,
    unknownFields: z.array(z.string().min(1).max(256)).max(128),
  })
  .refine((v) => distinct(v.lines.map((line) => line.lineId)));
export const CommerceProductSaleEvidenceSchema = z.strictObject({
  regularPrice: MoneySchema.nullable(),
  salePrice: MoneySchema.nullable(),
  observedAt: DateSchema,
});
export type CommerceProductSaleEvidence =
  z.infer<typeof CommerceProductSaleEvidenceSchema>;

export const CommerceProductSchema = z.strictObject({
  productId: ID,
  variantId: ID.nullable(),
  title: z.string().min(1).max(512),
  url: z
    .url({ protocol: /^https$/ })
    .refine((v) => {
      const u = new URL(v);
      return !u.username && !u.password && !u.port;
    })
    .nullable(),
  available: z.boolean().nullable(),
  unitPrice: MoneySchema.nullable(),
  currency: CurrencySchema.nullable(),
  productType: z.string().max(512).nullable(),
  vendor: z.string().max(512).nullable(),
  categories: z.array(z.string()).optional(),
  categoryIds: z.array(ID).max(128).optional(),
  collectionIds: z.array(ID).max(128).optional(),
  imageUrl: z.string().nullable().optional(),
  saleEvidence: CommerceProductSaleEvidenceSchema.nullable().optional(),
  observedAt: DateSchema,
});
export const CommerceOfferSchema = z
  .strictObject({
    offerId: ID,
    title: z.string().min(1).max(512),
    method: z.enum(["AUTOMATIC", "CODE"]),
    code: z.string().min(1).max(128).nullable(),
    startsAt: DateSchema.nullable(),
    endsAt: DateSchema.nullable(),
    support: z.enum(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]),
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
  })
  .refine(
    (v) =>
      (v.startsAt === null ||
        v.endsAt === null ||
        Date.parse(v.startsAt) < Date.parse(v.endsAt)) &&
      (v.method !== "AUTOMATIC" || v.code === null),
  );
export const CommerceDiscountCombinationFactsSchema = z.strictObject({
  discountClasses: z.array(z.enum(["ORDER", "PRODUCT", "SHIPPING"])).max(3).nullable(),
  shopifyPlus: z.boolean().nullable(),
  combinesWith: z.strictObject({
    orderDiscounts: z.boolean().nullable(),
    productDiscounts: z.boolean().nullable(),
    shippingDiscounts: z.boolean().nullable(),
  }).nullable(),
  discountTags: z.array(z.string().min(1).max(128)).max(64).nullable(),
  allowedSameLineProductTags: z.array(z.string().min(1).max(128)).max(64).nullable(),
});
export type CommerceDiscountCombinationFacts = z.infer<
  typeof CommerceDiscountCombinationFactsSchema
>;
export const CommerceDiscountConditionFactsSchema = z.strictObject({
  provider: z.enum(["SHOPIFY", "WOOCOMMERCE"]),
  completeness: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
  observedAt: DateSchema,
  providerStatus: z.string().max(64),
  unavailableAt: DateSchema.nullable(),
  discountKind: z.enum([
    "PERCENTAGE",
    "FIXED_AMOUNT",
    "FREE_SHIPPING",
    "BUY_X_GET_Y",
    "OTHER",
    "UNKNOWN",
  ]),
  discountValue: MoneySchema.nullable(),
  discountCurrency: CurrencySchema.nullable(),
  targeting: z.strictObject({
    kind: z.enum([
      "ALL",
      "PRODUCTS",
      "VARIANTS",
      "CATEGORIES",
      "COLLECTIONS",
      "MIXED",
      "UNKNOWN",
    ]),
    includedProductIds: z.array(ID).max(128),
    includedVariantIds: z.array(ID).max(128),
    includedCategoryIds: z.array(ID).max(128),
    includedCollectionIds: z.array(ID).max(128),
    excludedProductIds: z.array(ID).max(128),
    excludedVariantIds: z.array(ID).max(128),
    excludedCategoryIds: z.array(ID).max(128),
    excludedCollectionIds: z.array(ID).max(128),
  }),
  minimumSubtotal: MoneySchema.nullable(),
  maximumSubtotal: MoneySchema.nullable(),
  subtotalRequirementCurrency: CurrencySchema.nullable(),
  minimumQuantity: z.number().int().nonnegative().nullable(),
  usageLimit: z.number().int().nonnegative().nullable(),
  usageCount: z.number().int().nonnegative().nullable(),
  perCustomerLimit: z.number().int().nonnegative().nullable(),
  customerScope: z.enum(["ALL", "RESTRICTED", "UNKNOWN"]),
  excludesSaleItems: z.boolean().nullable(),
  individualUse: z.boolean().nullable(),
  combination: CommerceDiscountCombinationFactsSchema,
  unrepresentedConditions: z.array(z.string().min(1).max(128)).max(24),
});
export type CommerceDiscountConditionFacts = z.infer<
  typeof CommerceDiscountConditionFactsSchema
>;
export const CommerceDiscountDetailsSchema = z.strictObject({
  offer: CommerceOfferSchema,
  facts: CommerceDiscountConditionFactsSchema,
  providerDiscountId: z.string().min(1).max(191).nullable(),
});
export type CommerceDiscountDetails = z.infer<
  typeof CommerceDiscountDetailsSchema
>;
const condition = z.strictObject({
  code: z.string().min(1).max(64),
  description: z.string().max(256),
});
export const CommerceEvidenceSchema = z
  .strictObject({
    evidenceId: HashSchema,
    turn: CommerceTurnIdentitySchema,
    grantId: ID,
    releaseId: ID,
    offerId: ID,
    proposal: CommerceProposalSchema.nullable(),
    basketFingerprint: HashSchema,
    ruleFingerprint: HashSchema,
    evaluatedAt: DateSchema,
    expiresAt: DateSchema,
    outcome: z.enum([
      "QUALIFIES_FOR_KNOWN_RULES",
      "DOES_NOT_QUALIFY",
      "UNKNOWN",
      "UNSUPPORTED",
    ]),
    currency: CurrencySchema.nullable(),
    savings: MoneySchema.nullable(),
    resultingTotal: MoneySchema.nullable(),
    evaluatedConditions: z.array(condition).max(32),
    unresolvedConditions: z.array(condition).max(32),
  })
  .superRefine((v, c) => {
    if (Date.parse(v.expiresAt) - Date.parse(v.evaluatedAt) > 60000)
      c.addIssue({
        code: "custom",
        message: "Evidence lifetime exceeds ceiling",
      });
    if (
      v.outcome === "QUALIFIES_FOR_KNOWN_RULES" &&
      (v.unresolvedConditions.length ||
        Date.parse(v.expiresAt) <= Date.parse(v.evaluatedAt) ||
        v.currency === null ||
        v.savings === null ||
        v.resultingTotal === null)
    )
      c.addIssue({ code: "custom", message: "Unsupported qualifying claim" });
  });
export type CommerceEvidence = z.infer<typeof CommerceEvidenceSchema>;
export const CommerceAlternativeSchema = z
  .strictObject({
    product: CommerceProductSchema,
    proposal: CommerceProposalSchema,
    extraSpend: MoneySchema.nullable(),
    resultingTotal: MoneySchema.nullable(),
    currency: CurrencySchema.nullable(),
    evidence: CommerceEvidenceSchema.nullable(),
    similarityReasons: z.array(z.string().max(256)).max(3),
  })
  .refine((v) => v.product.available === true);
export const CommerceErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "DENIED",
  "STALE_TURN",
  "NOT_FOUND",
  "UNAVAILABLE",
  "THROTTLED",
  "DEADLINE",
  "INCOMPATIBLE_VERSION",
]);
export function commerceToolResultSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.strictObject({
      contractVersion: V,
      status: z.literal("OK"),
      data,
      renderedText: z.string().max(4096),
    }),
    z.strictObject({
      contractVersion: V,
      status: z.literal("ERROR"),
      code: CommerceErrorCodeSchema,
      retryable: z.boolean(),
      renderedText: z.string().max(4096).optional(),
    }),
  ]);
}
export const CommerceToolResultSchema = commerceToolResultSchema(
  boundedJson(262144),
);
export type CommerceToolResult = z.infer<typeof CommerceToolResultSchema>;
const wireId = z.string().min(1).max(128);
const taxonomySource = z.enum(["SHOPIFY_STANDARD_PRODUCT_TAXONOMY"]).meta({maxLength: 33});
export const CommerceCategoryCandidateSchema = z.strictObject({
  categoryId: wireId,
  name: z.string().min(1).max(512),
  fullName: z.string().min(1).max(4096),
  parentId: wireId.nullable(),
  level: z.number().int().min(0).max(32),
  ancestorIds: z.array(wireId).max(32),
  distance: z.number().min(0).max(2),
});
export type CommerceCategoryCandidate = z.infer<typeof CommerceCategoryCandidateSchema>;
export const CommerceCategoryResolutionSchema = z.union([
  z.strictObject({
    outcome: z.enum(["CANDIDATES", "NO_CANDIDATES"]).meta({maxLength: 13}),
    generationId: wireId,
    source: taxonomySource,
    taxonomyVersion: z.string().min(1).max(64),
    languageTag: z.string().min(1).max(35),
    candidates: z.array(CommerceCategoryCandidateSchema).max(10),
  }),
  z.strictObject({
    outcome: z.enum(["UNAVAILABLE"]).meta({maxLength: 11}),
    reasonCode: z.enum(["NOT_READY", "TEMPORARY_UNAVAILABLE"]).meta({maxLength: 21}),
  }),
]);
export type CommerceCategoryResolution = z.infer<typeof CommerceCategoryResolutionSchema>;
export const CommerceOptionalLookupUnavailableSchema = z.strictObject({
  outcome: z.enum(["UNAVAILABLE"]).meta({maxLength: 11}),
  reasonCode: z.enum(["TEMPORARY_UNAVAILABLE"]).meta({maxLength: 21}),
});
export type CommerceOptionalLookupUnavailable = z.infer<typeof CommerceOptionalLookupUnavailableSchema>;
export const CommerceConversationToolContextSchema = z.strictObject({
  purpose: z.enum(["CONVERSATION"]).meta({maxLength: 12}),
  conversationId: ID,
  inboundVersion: z.number().int().positive(),
  grantId: ID.nullable(),
});
export type CommerceConversationToolContext = z.infer<typeof CommerceConversationToolContextSchema>;
export const CommerceProductRecommendationSelectionSchema = z.strictObject({
  productRecommendationVersion: z.enum(["1"]).meta({maxLength: 1}).optional(),
  productRecommendations: z.array(z.strictObject({
    scope: z.enum(["PRODUCT_ONLY", "ADD_TO_BASKET", "REPLACE_BASKET_LINE"]).meta({maxLength: 19}),
    basketLineId: wireId.nullable(),
    productId: wireId,
    variantId: wireId.nullable(),
    quantity: z.number().int().min(1).max(99),
    promotionKind: z.enum(["NONE", "NATIVE_SALE", "DISCOUNT"]).meta({maxLength: 11}),
    offerIds: z.array(wireId).max(3),
  })).min(1).max(3).optional(),
});
export type CommerceProductRecommendationSelection = z.infer<typeof CommerceProductRecommendationSelectionSchema>;
export const CommerceResponseDispositionSchema = z.enum([
  "STANDARD", "OUT_OF_SCOPE_REDIRECT", "SHIPPING_INFORMATION_UNVERIFIED",
]).meta({maxLength: 31});
export type CommerceResponseDisposition = z.infer<typeof CommerceResponseDispositionSchema>;
export const CommerceAnswerPresentationSelectionSchema = z.strictObject({
  responseDisposition: CommerceResponseDispositionSchema.optional(),
  shippingInformationSelection: z.strictObject({
    productId: wireId.nullable(),
    variantId: wireId.nullable(),
  }).optional(),
});
export type CommerceAnswerPresentationSelection = z.infer<typeof CommerceAnswerPresentationSelectionSchema>;
export const CommerceShippingInformationInputSchema = z.strictObject({
  productId: wireId.nullable().default(null),
  variantId: wireId.nullable().default(null),
});
export type CommerceShippingInformationInput = z.infer<typeof CommerceShippingInformationInputSchema>;
// Relationships, current-shop ownership and policy UTF-8 budgets belong to the adapter.
export const CommerceShippingInformationSchema = z.strictObject({
  provider: z.enum(["SHOPIFY", "WOOCOMMERCE"]).meta({maxLength: 11}),
  observedAt: DateSchema,
  product: z.strictObject({
    status: z.enum(["NOT_REQUESTED", "VARIANT_REQUIRED", "AVAILABLE"]).meta({maxLength: 16}),
    productId: wireId.nullable(),
    variantId: wireId.nullable(),
    requiresShipping: z.boolean().nullable(),
    virtual: z.boolean().nullable(),
    weight: z.strictObject({
      value: z.number().min(0),
      unit: z.enum(["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"]).meta({maxLength: 9}).nullable(),
    }).nullable(),
    dimensions: z.strictObject({
      length: z.number().min(0).nullable(),
      width: z.number().min(0).nullable(),
      height: z.number().min(0).nullable(),
      unit: z.string().min(1).max(16).nullable(),
    }).nullable(),
    shippingClassId: wireId.nullable(),
    shippingClassSlug: z.string().min(1).max(512).nullable(),
  }),
  policy: z.strictObject({
    status: z.enum(["AVAILABLE", "NOT_CONFIGURED", "SCOPE_NOT_GRANTED", "UNSUPPORTED"]).meta({maxLength: 17}),
    trust: z.enum(["UNTRUSTED_REFERENCE"]).meta({maxLength: 19}),
    title: z.string().min(1).max(512).nullable(),
    bodyStatus: z.enum(["AVAILABLE", "EMPTY", "TOO_LARGE", "NOT_AVAILABLE"]).meta({maxLength: 13}),
    bodyHtml: z.string().min(1).max(8000).nullable(),
    url: z.url({protocol: /^https$/}).min(1).max(2048).nullable(),
    updatedAt: DateSchema.nullable(),
  }),
});
export type CommerceShippingInformation = z.infer<typeof CommerceShippingInformationSchema>;
const limit = z.number().int().min(1).max(3).default(3);
export const CommerceToolInputs = {
  commerce_resolve_product_categories: z.strictObject({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  commerce_get_shipping_information: CommerceShippingInformationInputSchema,
  commerce_get_basket: z.strictObject({}),
  commerce_search_products: z.strictObject({
    query: z.string().min(1).max(200).nullable().default(null),
    category: z.strictObject({
      system: z.enum(["SHOPIFY_STANDARD_PRODUCT_TAXONOMY", "WOOCOMMERCE_PRODUCT_CATEGORY"]).meta({maxLength: 33}),
      id: wireId,
      taxonomyVersion: z.string().min(1).max(64).nullable(),
    }).optional(),
    browse: z.boolean().default(false),
    maximumPrice: MoneySchema.optional(),
    availableOnly: z.boolean().default(true),
    limit: z.number().int().min(1).max(20).default(10),
    cursor: z.string().max(2048).nullable().default(null),
  }),
  commerce_get_product: z.strictObject({
    productId: ID,
    variantId: ID.nullable(),
  }),
  commerce_get_discount_options: z.strictObject({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(2048).nullable().default(null),
  }),
  commerce_get_discount_details: z.strictObject({ offerId: ID }),
  commerce_evaluate_discount: z.strictObject({
    offerId: ID,
    proposal: CommerceProposalSchema.nullable(),
  }),
  commerce_find_qualifying_products: z.strictObject({
    offerId: ID,
    query: z.string().min(1).max(200).nullable(),
    limit,
  }),
  commerce_find_similar_products: z.strictObject({
    variantId: ID,
    offerId: ID.nullable(),
    limit,
  }),
};
const alternatives = z.strictObject({
  alternatives: z.array(CommerceAlternativeSchema).max(3),
  truncated: z.boolean(),
});
export const CommerceToolOutputs = {
  commerce_resolve_product_categories: CommerceCategoryResolutionSchema,
  commerce_get_shipping_information: CommerceShippingInformationSchema,
  commerce_get_basket: CommerceBasketSchema,
  commerce_search_products: z.strictObject({
    products: z.array(CommerceProductSchema).max(20),
    cursor: z.string().max(2048).nullable(),
    truncated: z.boolean(),
  }),
  commerce_get_product: z.strictObject({
    product: CommerceProductSchema.nullable(),
  }),
  commerce_get_discount_options: z.union([CommerceOptionalLookupUnavailableSchema, z.strictObject({
    mode: z.enum(["NONE", "FIXED", "AI_BEST_APPLICABLE"]),
    offers: z.array(CommerceOfferSchema).max(50),
    truncated: z.boolean(),
    cursor: z.string().max(2048).nullable().optional(),
  })]),
  commerce_get_discount_details: z.union([CommerceOptionalLookupUnavailableSchema, z.strictObject({
    details: CommerceDiscountDetailsSchema.nullable(),
  })]),
  commerce_evaluate_discount: CommerceEvidenceSchema,
  commerce_find_qualifying_products: alternatives,
  commerce_find_similar_products: alternatives,
};
export function productBelongsToDomain(
  product: z.infer<typeof CommerceProductSchema>,
  verifiedDomain: string,
) {
  try {
    return (
      product.url === null || new URL(product.url).hostname === verifiedDomain
    );
  } catch {
    return false;
  }
}
