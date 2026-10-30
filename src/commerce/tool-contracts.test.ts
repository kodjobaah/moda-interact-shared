import assert from "node:assert/strict";
import test from "node:test";

import {
  CommerceToolInputs,
  CommerceToolOutputs,
  CommerceEvidenceSchema,
  CommerceProductSchema,
  CommerceProductSaleEvidenceSchema,
  CommerceDiscountConditionFactsSchema,
  CommerceDiscountDetailsSchema,
  commerceToolResultSchema,
  type CommerceDiscountConditionFacts,
  type CommerceDiscountDetails,
} from "./index";
import { exampleTurn } from "./fixtures";

const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, true);
const bad = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, false);

const product = {
  productId: "product_123",
  variantId: "variant_456",
  title: "Running socks",
  url: "https://store.example.com/products/running-socks",
  available: true,
  unitPrice: "16.00",
  currency: "GBP",
  productType: "Accessories",
  vendor: "Moda Store",
  observedAt: "2026-10-29T18:00:00.000Z",
};
const discountOffer = {
  offerId: "offer-20",
  title: "Socks 20",
  method: "CODE" as const,
  code: "SOCKS20",
  startsAt: null,
  endsAt: null,
  support: "SUPPORTED" as const,
  reasonCodes: [],
};
const discountFacts = {
  provider: "WOOCOMMERCE",
  completeness: "COMPLETE",
  observedAt: "2026-10-30T09:00:00.000Z",
  providerStatus: "ACTIVE",
  unavailableAt: null,
  discountKind: "PERCENTAGE",
  discountValue: "20",
  discountCurrency: null,
  targeting: {
    kind: "PRODUCTS",
    includedProductIds: ["401"],
    includedVariantIds: [],
    includedCategoryIds: [],
    includedCollectionIds: [],
    excludedProductIds: [],
    excludedVariantIds: [],
    excludedCategoryIds: [],
    excludedCollectionIds: [],
  },
  minimumSubtotal: null,
  maximumSubtotal: null,
  minimumQuantity: null,
  usageLimit: null,
  usageCount: null,
  perCustomerLimit: null,
  customerScope: "ALL",
  excludesSaleItems: false,
  individualUse: false,
  unrepresentedConditions: [],
} satisfies CommerceDiscountConditionFacts;
const discountDetails = {
  offer: discountOffer,
  facts: discountFacts,
} satisfies CommerceDiscountDetails;

test("six policy input/output fixtures preserve exact money and explicit unknown/unsupported outcomes", () => {
  const now = "2026-09-20T00:00:00.000Z",
    hash = "a".repeat(64);
  const basket = {
    basketId: "basket",
    source: "RECOVERY_SNAPSHOT",
    observedAt: now,
    currency: null,
    lines: [],
    fingerprint: hash,
    unknownFields: ["lines"],
  };
  const evidence = {
    evidenceId: hash,
    turn: exampleTurn,
    grantId: "grant",
    releaseId: "release",
    offerId: "offer",
    proposal: null,
    basketFingerprint: hash,
    ruleFingerprint: hash,
    evaluatedAt: now,
    expiresAt: "2026-09-20T00:01:00.000Z",
    outcome: "UNKNOWN",
    currency: null,
    savings: null,
    resultingTotal: null,
    evaluatedConditions: [],
    unresolvedConditions: [
      { code: "missing", description: "No current basket" },
    ],
  };
  const fixtures = {
    commerce_get_basket: [{}, basket],
    commerce_search_products: [
      { query: "coat" },
      {
        products: [{
          ...product,
          categories: ["Running", "Accessories"],
          imageUrl: "https://store.example.com/media/socks.jpg",
          saleEvidence: {
            regularPrice: "20.00",
            salePrice: "22.00",
            observedAt: "2026-10-29T18:00:00.000Z",
          },
        }],
        cursor: null,
        truncated: false,
      },
    ],
    commerce_get_product: [
      { productId: "product_123", variantId: null },
      { product: null },
    ],
    commerce_get_discount_options: [
      {},
      {
        mode: "FIXED",
        offers: [discountOffer],
        cursor: "opaque-continuation-token",
        truncated: true,
      },
    ],
    commerce_get_discount_details: [
      { offerId: "offer-20" },
      { details: discountDetails },
    ],
    commerce_evaluate_discount: [
      { offerId: "offer", proposal: null },
      evidence,
    ],
    commerce_find_qualifying_products: [
      { offerId: "offer", query: null },
      { alternatives: [], truncated: false },
    ],
    commerce_find_similar_products: [
      { variantId: "variant", offerId: null },
      { alternatives: [], truncated: false },
    ],
  };
  for (const name of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
    ok(CommerceToolInputs[name], fixtures[name][0]);
    ok(CommerceToolOutputs[name], fixtures[name][1]);
    bad(CommerceToolInputs[name], { ...fixtures[name][0], shopId: "foreign" });
    bad(CommerceToolOutputs[name], { ...fixtures[name][1], unexpected: true });
  }
  bad(CommerceEvidenceSchema, {
    ...evidence,
    outcome: "QUALIFIES_FOR_KNOWN_RULES",
  });
  bad(CommerceEvidenceSchema, { ...evidence, savings: 1 });
  bad(CommerceEvidenceSchema, { ...evidence, currency: "INVALID" });
});

test("discount discovery and condition contracts stay structural and use the generic result envelope", () => {
  const discountOptionsInput = CommerceToolInputs.commerce_get_discount_options;
  assert.deepEqual(discountOptionsInput.parse({}), { limit: 20, cursor: null });
  bad(discountOptionsInput, { limit: 0 });
  bad(discountOptionsInput, { limit: 51 });
  bad(discountOptionsInput, { cursor: 7 });
  bad(discountOptionsInput, { unexpected: true });
  bad(CommerceToolInputs.commerce_get_discount_details, {
    offerId: "offer-20",
    shopId: "model_forged_shop",
  });

  const optionsOutput = {
    mode: "FIXED",
    offers: [discountOffer],
    cursor: "opaque-continuation-token",
    truncated: true,
  };
  ok(CommerceToolOutputs.commerce_get_discount_options, optionsOutput);
  ok(CommerceToolOutputs.commerce_get_discount_options, {
    mode: "NONE",
    offers: [],
    truncated: false,
  });
  bad(CommerceToolOutputs.commerce_get_discount_options, {
    ...optionsOutput,
    unexpected: true,
  });
  const optionsResult = commerceToolResultSchema(
    CommerceToolOutputs.commerce_get_discount_options,
  );
  ok(optionsResult, {
    contractVersion: "commerce.v1",
    status: "OK",
    data: optionsOutput,
    renderedText: "Discount options loaded",
  });

  ok(CommerceDiscountConditionFactsSchema, discountFacts);
  ok(CommerceDiscountDetailsSchema, discountDetails);
  bad(CommerceDiscountConditionFactsSchema, {
    ...discountFacts,
    discountValue: 20,
  });
  bad(CommerceDiscountConditionFactsSchema, {
    ...discountFacts,
    targeting: {
      ...discountFacts.targeting,
      includedProductIds: [401],
    },
  });
  bad(CommerceDiscountConditionFactsSchema, {
    ...discountFacts,
    completeness: "INFERRED",
  });
  bad(CommerceToolOutputs.commerce_get_discount_details, {
    details: { offer: discountOffer },
  });

  const genericResult = commerceToolResultSchema(
    CommerceToolOutputs.commerce_get_discount_details,
  );
  ok(genericResult, {
    contractVersion: "commerce.v1",
    status: "OK",
    data: { details: discountDetails },
    renderedText: "Discount details loaded",
  });
  ok(genericResult, {
    contractVersion: "commerce.v1",
    status: "OK",
    data: { details: null },
    renderedText: "Discount not found",
  });
  bad(genericResult, {
    contractVersion: "commerce.v1",
    status: "OK",
    data: { details: discountDetails },
    renderedText: "x".repeat(4097),
  });
  bad(genericResult, {
    contractVersion: "commerce.v1",
    status: "OK",
    data: { details: discountDetails },
    renderedText: "Discount details loaded",
    unexpected: true,
  });
});

test("existing products remain compatible and sale evidence stays structural", () => {
  ok(CommerceProductSchema, product);
  ok(CommerceProductSchema, {
    ...product,
    categories: ["Running", "Accessories"],
    categoryIds: ["cat_123"],
    collectionIds: ["gid://shopify/Collection/456"],
    imageUrl: "not-a-validated-provider-url",
    saleEvidence: {
      regularPrice: "20.00",
      salePrice: "22.00",
      observedAt: "2026-10-29T18:00:00.000Z",
    },
  });
  ok(CommerceProductSchema, { ...product, variantId: null });
  ok(CommerceProductSchema, {
    ...product,
    variantId: "gid://shopify/ProductVariant/456",
  });
  bad(CommerceProductSchema, { ...product, categoryIds: [123] });
  bad(CommerceProductSchema, { ...product, collectionIds: [123] });
  ok(CommerceToolOutputs.commerce_search_products, {
    products: [product],
    cursor: null,
    truncated: false,
  });
  ok(CommerceToolOutputs.commerce_get_product, { product });
  ok(CommerceProductSaleEvidenceSchema, {
    regularPrice: null,
    salePrice: "16.00",
    observedAt: "2026-10-29T18:00:00.000Z",
  });

  bad(CommerceProductSchema, (({ productId: _id, ...rest }) => rest)(product));
  bad(CommerceProductSchema, { ...product, unexpected: true });
  bad(CommerceProductSaleEvidenceSchema, {
    regularPrice: "20.00",
    salePrice: "16.00",
    observedAt: "not-a-date",
  });
  bad(CommerceToolInputs.commerce_get_product, { productId: "", variantId: null });
  bad(CommerceToolInputs.commerce_get_product, { productId: "product_123", variantId: 7 });
  bad(CommerceToolInputs.commerce_get_product, {
    productId: "product_123",
    variantId: null,
    shopId: "model_forged_shop",
  });
});