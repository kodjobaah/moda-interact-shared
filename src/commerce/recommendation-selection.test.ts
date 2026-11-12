import assert from "node:assert/strict";
import test from "node:test";
import { readCommerceRecommendationSelection, hasCommerceAcceptedProductSelection, isCommerceShippingObservationForSelection, readCommerceObservedShippingSelections } from "./recommendation-selection.js";
import { CommerceProductRecommendationSelectionSchema } from "./schemas.js";
import { EMPTY_RESPONSE_CONTRACT, type CommerceResponseContract } from "./response.js";

const product = { scope: "PRODUCT_ONLY", basketLineId: null, productId: "product", variantId: null, quantity: 1, promotionKind: "NONE", offerIds: [] };
const contract = { ...EMPTY_RESPONSE_CONTRACT, detailsSchema: { ...EMPTY_RESPONSE_CONTRACT.detailsSchema, properties: { productRecommendationVersion: { type: "string", maxLength: 1 }, productRecommendations: { type: "array", maxItems: 3, items: { type: "string", maxLength: 128 } } } } } as CommerceResponseContract;
const shipping = (productId: string | null = null, variantId: string | null = null, provider = "SHOPIFY") => ({
  provider, observedAt: "2026-11-12T00:00:00Z", product: { status: productId ? "AVAILABLE" : "NOT_REQUESTED", productId, variantId, requiresShipping: null, virtual: null, weight: null, dimensions: null, shippingClassId: null, shippingClassSlug: null },
  policy: { status: "NOT_CONFIGURED", trust: "UNTRUSTED_REFERENCE", title: null, bodyStatus: "NOT_AVAILABLE", bodyHtml: null, url: null, updatedAt: null },
});
const messages = (data = shipping()) => [{ tool: "commerce_get_shipping_information", result: { status: "OK", data } }];

test("canonical parser retains valid pairs but never infers a missing version or list", () => {
  const valid = { productRecommendationVersion: "1", productRecommendations: [product], responseDisposition: "STANDARD" };
  assert.deepEqual(readCommerceRecommendationSelection(valid), valid);
  assert.equal(Object.isFrozen(readCommerceRecommendationSelection(valid)), true);
  for (const partial of [{ productRecommendations: [product] }, { productRecommendationVersion: "1" }]) {
    assert.equal(CommerceProductRecommendationSelectionSchema.safeParse(partial).success, true);
    assert.deepEqual(readCommerceRecommendationSelection({ ...partial, responseDisposition: "STANDARD" }), { responseDisposition: "STANDARD" });
  }
});
test("normalized empty optional lists do not mutate input and preserve independent structural schemas", () => {
  const raw = { productRecommendationVersion: "1", productRecommendations: [], productOptionSelections: [], responseDisposition: "STANDARD" };
  assert.deepEqual(readCommerceRecommendationSelection(raw), { responseDisposition: "STANDARD" });
  assert.deepEqual(raw.productRecommendations, []);
  assert.equal(raw.productRecommendationVersion, "1");
  assert.doesNotThrow(() => CommerceProductRecommendationSelectionSchema.extend({}));
});
test("partial disposition recovery and recognized shipping selections retain host semantics", () => {
  const pair = { productId: null, variantId: null };
  assert.deepEqual(readCommerceRecommendationSelection({ shippingInformationSelection: pair }), {});
  assert.deepEqual(readCommerceRecommendationSelection({ shippingInformationSelection: pair, responseDisposition: "STANDARD" }), { shippingInformationSelection: pair, responseDisposition: "STANDARD" });
  assert.deepEqual(readCommerceRecommendationSelection({ productRecommendations: [{ ...product, quantity: 0 }], responseDisposition: "OUT_OF_SCOPE_REDIRECT", shippingInformationSelection: { bad: true } }), { responseDisposition: "OUT_OF_SCOPE_REDIRECT" });
  assert.deepEqual(readCommerceRecommendationSelection({ responseDisposition: "STANDARD", shippingInformationSelection: { productId: null, variantId: "orphan" } }), { responseDisposition: "STANDARD" });
});
test("shipping qualifier matches canonical current provider/identity and truthful unavailable policy", () => {
  for (const provider of ["SHOPIFY", "WOOCOMMERCE"] as const) {
    const generic = { productId: null, variantId: null };
    assert.equal(isCommerceShippingObservationForSelection({ selection: generic, observation: shipping(null, null, provider), provider }), true);
    const pair = { productId: "product", variantId: "variant" };
    assert.equal(isCommerceShippingObservationForSelection({ selection: pair, observation: shipping("product", "variant", provider), provider }), true);
    for (const observation of [shipping("other", "variant", provider), shipping("product", "other", provider), shipping("product", "variant", provider === "SHOPIFY" ? "WOOCOMMERCE" : "SHOPIFY"), {}, { ...shipping(null, null, provider), product: { ...shipping().product, status: "AVAILABLE" } }]) {
      assert.equal(isCommerceShippingObservationForSelection({ selection: pair, observation, provider }), false);
    }
    assert.equal(isCommerceShippingObservationForSelection({ selection: generic, observation: { ...shipping(null, null, provider), product: { ...shipping().product, status: "AVAILABLE" } }, provider }), false);
  }
});
test("runtime shipping alternatives require matching successful authorized shipping observations", () => {
  const raw = { responseDisposition: "STANDARD", shippingInformationSelection: { productId: null, variantId: null } };
  assert.equal(hasCommerceAcceptedProductSelection(raw, contract), false);
  assert.equal(hasCommerceAcceptedProductSelection(raw, contract, messages(), "SHOPIFY"), true);
  assert.equal(hasCommerceAcceptedProductSelection({ responseDisposition: "SHIPPING_INFORMATION_UNVERIFIED" }, contract), false);
  assert.equal(hasCommerceAcceptedProductSelection({ responseDisposition: "SHIPPING_INFORMATION_UNVERIFIED" }, contract, messages(), "SHOPIFY"), true);
  for (const bad of [[], [{ tool: "commerce_search_products", result: { status: "OK", data: shipping() } }], [{ tool: "commerce_get_shipping_information", result: { status: "ERROR", data: shipping() } }], messages(shipping("other")), messages(shipping(null, null, "WOOCOMMERCE"))]) {
    assert.equal(hasCommerceAcceptedProductSelection(raw, contract, bad, "SHOPIFY"), false);
  }
  assert.deepEqual(readCommerceObservedShippingSelections([...messages(), ...messages()], "SHOPIFY"), [{ productId: null, variantId: null }]);
});
test("custom pinned contracts without canonical version/list pair retain strictly pinned behavior", () => {
  const custom = { ...contract, detailsSchema: { ...contract.detailsSchema, properties: { productRecommendations: contract.detailsSchema.properties!.productRecommendations } } };
  assert.equal(hasCommerceAcceptedProductSelection({ productRecommendations: ["custom-id"] }, custom), true);
  assert.equal(hasCommerceAcceptedProductSelection({ shippingInformationSelection: { productId: null, variantId: null } }, custom), true);
  assert.equal(hasCommerceAcceptedProductSelection({ responseDisposition: "STANDARD" }, custom), false);
});
