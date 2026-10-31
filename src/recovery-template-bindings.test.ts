import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RecoveryPromotionTargetSchema,
  RecoveryTemplateFrozenBindingsSchema,
  RecoveryTemplateHeaderMediaRoleSchema,
  RecoveryTemplateSemanticKeySchema,
  RecoveryTemplateTextBindingSchema,
  RecoveryTemplateUrlButtonBindingSchema,
} from "./recovery-template-bindings.js";

const checkoutProjection = {
  schemaVersion: 1,
  promotionTarget: "CHECKOUT",
  body: [
    { position: 1, variable: "customer.firstName" },
    { position: 2, variable: "checkout.itemsSummary" },
    { position: 3, variable: "offer.description" },
  ],
  buttons: [{ index: 0, subType: "url", variable: "checkout.url" }],
} as const;

const alternativeProductProjection = {
  schemaVersion: 1,
  promotionTarget: "ALTERNATIVE_PRODUCT",
  body: [
    { position: 1, variable: "promotion.productName" },
    { position: 2, variable: "promotion.offerDescription" },
  ],
  buttons: [{ index: 0, subType: "url", variable: "promotion.productUrl" }],
} as const;

const expectedSemanticKeys = [
  "customer.firstName",
  "shop.name",
  "shop.categoryName",
  "checkout.url",
  "checkout.itemsSummary",
  "offer.code",
  "offer.codes",
  "offer.description",
  "promotion.productName",
  "promotion.productUrl",
  "promotion.offerDescription",
  "promotion.code",
  "shopBrand.brandName",
  "shopBrand.logoUrl",
  "shopBrand.logoAltText",
  "shopBrand.logoWidth",
  "shopBrand.logoHeight",
  "shopBrand.squareLogoUrl",
  "shopBrand.squareLogoAltText",
  "shopBrand.coverImageUrl",
];

test("preserves all semantic keys and existing ShopBrand media roles", () => {
  assert.deepEqual(RecoveryTemplateSemanticKeySchema.options, expectedSemanticKeys);
  assert.deepEqual(RecoveryTemplateHeaderMediaRoleSchema.options, [
    "LOGO",
    "SQUARE_LOGO",
    "COVER_IMAGE",
    "CHECKOUT_PRODUCT",
  ]);
});

test("offer.codes is one body text semantic and is not a template button binding", () => {
  assert.deepEqual(RecoveryTemplateTextBindingSchema.parse({ position: 4, variable: "offer.codes" }), {
    position: 4,
    variable: "offer.codes",
  });
  assert.equal(RecoveryTemplateSemanticKeySchema.safeParse(["offer.codes"]).success, false);
  assert.equal(RecoveryTemplateUrlButtonBindingSchema.safeParse({
    index: 0,
    subType: "url",
    variable: "offer.codes",
  }).success, false);
});

test("parses the illustrative checkout and alternative-product projections", () => {
  assert.deepEqual(
    RecoveryTemplateFrozenBindingsSchema.parse(checkoutProjection),
    checkoutProjection,
  );
  assert.deepEqual(
    RecoveryTemplateFrozenBindingsSchema.parse(alternativeProductProjection),
    alternativeProductProjection,
  );
});

test("keeps promotion target and header media role optional for existing projections", () => {
  const existingProjection = {
    body: [{ position: 0, variable: "shop.name" }],
    buttons: [],
  };

  assert.deepEqual(
    RecoveryTemplateFrozenBindingsSchema.parse(existingProjection),
    existingProjection,
  );
  assert.equal(RecoveryPromotionTargetSchema.safeParse(undefined).success, false);
});

test("rejects unknown keys, semantic variables, target values, and noninteger positions", () => {
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      unrecognized: true,
    }).success,
    false,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      body: [{ position: 0, variable: "promotion.newVariable" }],
    }).success,
    false,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      promotionTarget: "PRODUCT",
    }).success,
    false,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      body: [{ position: 1.5, variable: "customer.firstName" }],
    }).success,
    false,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      buttons: [{ index: 0.5, subType: "url", variable: "checkout.url" }],
    }).success,
    false,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.safeParse({
      ...checkoutProjection,
      body: [{ position: 0, variable: "customer.firstName", extra: "value" }],
    }).success,
    false,
  );
});

test("does not enforce business pairings or validate checkout URL content", () => {
  const structurallyValidBusinessMismatch = {
    schemaVersion: 1,
    promotionTarget: "ALTERNATIVE_PRODUCT",
    body: [],
    buttons: [{ index: 0, subType: "url", variable: "checkout.url" }],
  };

  assert.deepEqual(
    RecoveryTemplateFrozenBindingsSchema.parse(structurallyValidBusinessMismatch),
    structurallyValidBusinessMismatch,
  );
  assert.equal(
    RecoveryTemplateFrozenBindingsSchema.parse({
      body: [],
      buttons: [{ index: 0, subType: "url", variable: "checkout.url" }],
    }).buttons[0]?.variable,
    "checkout.url",
  );
});
