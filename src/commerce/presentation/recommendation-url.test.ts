import assert from "node:assert/strict";
import test from "node:test";
import { MODA_SUPPORTED_LANGUAGE_TAGS } from "../../internationalization.js";
import { CommerceVerifiedPresentationSchema, composeCommerceWhatsAppPreview, renderRecommendationReply } from "./index.js";

const product = { title: "Verified snowboard", url: null, quantity: 2, scope: "PRODUCT_ONLY" as const,
  currentPrice: "10.00", regularPrice: "12.00", currency: "GBP",
  offerTerms: [{ kind: "percent" as const, value: "10", code: "SAVE10" }] };
const presentation = { schemaVersion: 1 as const, brandName: "Merchant", locale: "en" as const,
  disposition: "STANDARD" as const, storeUrl: "https://shop.example", products: [product],
  optionFacts: [], requiresShipping: null, policyUrl: null, includeNoVerifiedOffer: false };
const envelope = { answerKind: "ANSWER" as const, replyText: "Supported answer", referralReason: null,
  detectedLanguageTag: null, detectedLanguageConfidence: null, evidenceIds: [], details: {} };

test("verified product-only catalogue recommendation without a URL composes without inventing a link", () => {
  const parsed = CommerceVerifiedPresentationSchema.parse(presentation);
  assert.deepEqual(parsed.products[0], product);
  const result = composeCommerceWhatsAppPreview({ envelope, presentation: parsed });
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") return;
  assert.match(result.body, /Verified snowboard/);
  assert.match(result.body, /10\.00/);
  assert.match(result.body, /12\.00/);
  assert.match(result.body, /SAVE10/);
  assert.doesNotMatch(result.body, /https?:\/\/|null|undefined/);
});

test("linkless product-only rendering preserves localized facts and linked recommendations", () => {
  for (const locale of MODA_SUPPORTED_LANGUAGE_TAGS) {
    const products = [product, { ...product, title: "Linked snowboard", url: "https://shop.example/products/linked" }];
    const parsed = CommerceVerifiedPresentationSchema.parse({ ...presentation, locale, products });
    const body = renderRecommendationReply({ ...parsed, disposition: "STANDARD" });
    assert.match(body, /Verified snowboard/);
    assert.match(body, /Linked snowboard/);
    assert.equal(body.split("https://shop.example/products/linked").length - 1, 1);
    assert.doesNotMatch(body, /null|undefined/);
  }
});

for (const scope of ["ADD_TO_BASKET", "REPLACE_BASKET_LINE"] as const) {
  test(`${scope} still requires an actionable verified URL`, () => {
    const invalid = { ...presentation, products: [{ ...product, scope }] };
    assert.equal(CommerceVerifiedPresentationSchema.safeParse(invalid).success, false);
    assert.deepEqual(composeCommerceWhatsAppPreview({ envelope, presentation: invalid as never }), { kind: "refused", reason: "INVALID_INPUT" });
    const valid = CommerceVerifiedPresentationSchema.parse({ ...invalid, products: [{ ...product, scope, url: "https://shop.example/products/action" }] });
    assert.match(renderRecommendationReply({ ...valid, disposition: "STANDARD" }), /https:\/\/shop\.example\/products\/action/);
  });
}

test("nonnull URLs retain safety and current-shop validation for every recommendation scope", () => {
  const unsafe = ["", "http://shop.example/product", "javascript:alert(1)", "https://user:pass@shop.example/product",
    "https://shop.example:444/product", "https://shop.example/product#fragment", "https://foreign.example/product",
    "https://localhost/product", "https://127.0.0.1/product", "https://[::1]/product", "https://shop.example/product\n"];
  for (const scope of ["PRODUCT_ONLY", "ADD_TO_BASKET", "REPLACE_BASKET_LINE"] as const) {
    for (const url of unsafe) assert.equal(CommerceVerifiedPresentationSchema.safeParse({ ...presentation, products: [{ ...product, scope, url }] }).success, false, `${scope}: ${JSON.stringify(url)}`);
    assert.equal(CommerceVerifiedPresentationSchema.safeParse({ ...presentation, products: [{ ...product, scope, url: undefined }] }).success, false);
  }
});
