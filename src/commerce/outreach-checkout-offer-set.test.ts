import assert from "node:assert/strict";
import test from "node:test";
import {
  InitialOutreachCheckoutOfferSetSchema,
  type InitialOutreachCheckoutOfferSet,
} from "./index";

const receipt = {
  schemaVersion: "moda.outreach.checkout-offers.v1",
  offers: [
    { offerId: "discount-10", providerDiscountId: "woo:coupon:10", method: "CODE", code: "SAVE10" },
    { offerId: "discount-20", providerDiscountId: "woo:coupon:20", method: "CODE", code: "SHIPFREE" },
  ],
} satisfies InitialOutreachCheckoutOfferSet;

test("checkout offer set round trips its exact version, identifiers, and sent order", () => {
  assert.deepEqual(InitialOutreachCheckoutOfferSetSchema.parse(receipt), receipt);
  const three = { ...receipt, offers: [
    ...receipt.offers,
    { offerId: "discount-30", providerDiscountId: null, method: "AUTOMATIC", code: null },
  ] } satisfies InitialOutreachCheckoutOfferSet;
  assert.deepEqual(InitialOutreachCheckoutOfferSetSchema.parse(three), three);
  const singleton = { ...receipt, offers: [receipt.offers[0]!] } satisfies InitialOutreachCheckoutOfferSet;
  assert.deepEqual(InitialOutreachCheckoutOfferSetSchema.parse(singleton), singleton);
});

test("checkout offer set enforces required fields, literals, member bounds, and strict keys", () => {
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [] }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [...receipt.offers, ...receipt.offers] }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, extra: true }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, schemaVersion: "v2" }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [{ ...receipt.offers[0], extra: true }] }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [{ ...receipt.offers[0], method: "UNKNOWN" }] }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [{ ...receipt.offers[0], offerId: "" }] }).success, false);
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [{ ...receipt.offers[0], code: "x".repeat(129) }] }).success, false);
  const { providerDiscountId: _providerDiscountId, ...missingIdentity } = receipt.offers[0]!;
  assert.equal(InitialOutreachCheckoutOfferSetSchema.safeParse({ ...receipt, offers: [missingIdentity] }).success, false);
});

test("wire validation preserves null identity and leaves method/code policy to consumers", () => {
  const structuralOnly = { schemaVersion: "moda.outreach.checkout-offers.v1", offers: [
    { offerId: "offer-a", providerDiscountId: null, method: "CODE", code: null },
    { offerId: "offer-b", providerDiscountId: "woo:coupon:b", method: "AUTOMATIC", code: "source-observation" },
  ] } satisfies InitialOutreachCheckoutOfferSet;
  assert.deepEqual(InitialOutreachCheckoutOfferSetSchema.parse(structuralOnly), structuralOnly);
});
