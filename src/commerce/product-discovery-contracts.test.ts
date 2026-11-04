import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {z} from "zod";
import {
  CommerceOfferSchema, CommerceDiscountConditionFactsSchema,
  CommerceCategoryCandidateSchema, CommerceCategoryResolutionSchema,
  CommerceShippingInformationSchema, CommerceShippingInformationInputSchema,
  CommerceAnswerPresentationSelectionSchema, CommerceResponseDispositionSchema,
  CommerceProductRecommendationSelectionSchema,
  CommerceOptionalLookupUnavailableSchema, CommerceToolInputs, CommerceToolOutputs,
  CommerceManifestSchema, CommerceConversationGrantSchema,
} from "./schemas";
import {
  CommerceBuiltInToolDescriptorSchema, CommerceBuiltInToolGrantSchema,
  GrantedToolsSchema, isBuiltInTool,
} from "./definitions";
import {commerceDiscountBuiltInDescriptors} from "./built-in-tools";
import {deduplicateTools, manifestMatchesGrant, currentlyGrantedTools} from "./selection";
import {exampleManifest, exampleGrant, exampleTool} from "./fixtures";
import {compileSubset} from "./subset";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const candidate = {categoryId: "provider-id", name: "Tools", fullName: "Hardware > Tools",
  parentId: null, level: 0, ancestorIds: [], distance: 0};
export const recommendation = {productRecommendationVersion: "1", productRecommendations: [{
  scope: "PRODUCT_ONLY", basketLineId: null, productId: "shop-product", variantId: null,
  quantity: 1, promotionKind: "NONE", offerIds: [],
}]};
test("category contracts enforce wire bounds without imposing service ranking or outcome policy", () => {
  assert.deepEqual(CommerceToolInputs.commerce_resolve_product_categories.parse({query: "hammer"}), {query: "hammer", limit: 5});
  for (const input of [{query: ""}, {query: "x".repeat(201)}, {query: "x", limit: 11}, {query: "x", shopId: "foreign"}])
    assert.equal(CommerceToolInputs.commerce_resolve_product_categories.safeParse(input).success, false);
  assert.ok(CommerceCategoryCandidateSchema.safeParse({...candidate, distance: 2, level: 32, ancestorIds: Array(32).fill("id")}).success);
  for (const patch of [{distance: Infinity}, {distance: -1}, {distance: 2.1}, {level: 33},
    {categoryId: ""}, {name: "x".repeat(513)}, {fullName: "x".repeat(4097)}, {ancestorIds: Array(33).fill("id")}, {extra: true}])
    assert.equal(CommerceCategoryCandidateSchema.safeParse({...candidate, ...patch}).success, false);
  const data = {outcome: "CANDIDATES", generationId: "generation", source: "SHOPIFY_STANDARD_PRODUCT_TAXONOMY",
    taxonomyVersion: "2026-08", languageTag: "en", candidates: [candidate]};
  assert.ok(CommerceCategoryResolutionSchema.safeParse(data).success);
  // Outcome/count relations, ordering and requested limit are deliberately service policy.
  assert.ok(CommerceCategoryResolutionSchema.safeParse({...data, candidates: []}).success);
  for (const patch of [{generationId: ""}, {languageTag: "x".repeat(36)}, {taxonomyVersion: "x".repeat(65)},
    {source: "invented"}, {candidates: Array(11).fill(candidate)}])
    assert.equal(CommerceCategoryResolutionSchema.safeParse({...data, ...patch}).success, false);
  for (const reasonCode of ["NOT_READY", "TEMPORARY_UNAVAILABLE"])
    assert.ok(CommerceToolOutputs.commerce_resolve_product_categories.safeParse({outcome: "UNAVAILABLE", reasonCode}).success);
});
test("flat search input preserves old filters and defaults while leaving category applicability to services", () => {
  const schema = CommerceToolInputs.commerce_search_products;
  assert.deepEqual(schema.parse({}), {query: null, browse: false, availableOnly: true, limit: 10, cursor: null});
  assert.equal(schema.parse({query: "coat", maximumPrice: "12.50", availableOnly: false, limit: 20}).query, "coat");
  assert.ok(schema.safeParse({category: {system: "WOOCOMMERCE_PRODUCT_CATEGORY", id: "not-a-native-id", taxonomyVersion: "service-rejects"}}).success);
  for (const patch of [{query: ""}, {query: "x".repeat(201)}, {limit: 21}, {cursor: "x".repeat(2049)},
    {category: {system: "OTHER", id: "1", taxonomyVersion: null}},
    {category: {system: "WOOCOMMERCE_PRODUCT_CATEGORY", id: "", taxonomyVersion: null}},
    {category: {system: "WOOCOMMERCE_PRODUCT_CATEGORY", id: "1", taxonomyVersion: null, descendants: true}}])
    assert.equal(schema.safeParse(patch).success, false);
});
test("discount optional unavailability is disjoint and normal success bytes retain their shape", () => {
  const options = {mode: "NONE", offers: [], truncated: false};
  const details = {details: null};
  assert.deepEqual(CommerceToolOutputs.commerce_get_discount_options.parse(options), options);
  assert.deepEqual(CommerceToolOutputs.commerce_get_discount_details.parse(details), details);
  const unavailable = {outcome: "UNAVAILABLE", reasonCode: "TEMPORARY_UNAVAILABLE"};
  for (const schema of [CommerceToolOutputs.commerce_get_discount_options, CommerceToolOutputs.commerce_get_discount_details]) {
    assert.deepEqual(schema.parse(unavailable), unavailable);
    assert.equal(schema.safeParse({...unavailable, offers: []}).success, false);
    assert.equal(schema.safeParse({...unavailable, reasonCode: "DENIED"}).success, false);
  }
  assert.equal(CommerceOptionalLookupUnavailableSchema.safeParse({outcome: "UNAVAILABLE", reasonCode: "NOT_READY"}).success, false);
});
test("recommendation fields are structural and identifier-only", () => {
  const schema = CommerceProductRecommendationSelectionSchema;
  assert.deepEqual(schema.parse({}), {});
  assert.ok(schema.safeParse(recommendation).success);
  assert.ok(schema.safeParse({productRecommendationVersion: "1"}).success);
  const entry = recommendation.productRecommendations[0];
  // Scope/offer relationships are service policy, not a new cross-field refinement.
  assert.ok(schema.safeParse({productRecommendations: [{...entry, scope: "REPLACE_BASKET_LINE", promotionKind: "DISCOUNT"}]}).success);
  for (const patch of [{quantity: 0}, {quantity: 100}, {productId: ""}, {variantId: "x".repeat(129)},
    {offerIds: ["a", "b", "c", "d"]}, {price: "1.00"}, {evidenceIds: ["invented"]}])
    assert.equal(schema.safeParse({productRecommendations: [{...entry, ...patch}]}).success, false);
  assert.equal(schema.safeParse({productRecommendations: []}).success, false);
  assert.equal(schema.safeParse({productRecommendations: Array(4).fill(entry)}).success, false);
});
test("built-in contracts preserve canonical name/version and bounded inputs without hash identity", () => {
  const expected = [
    {
      name: "commerce_get_discount_options",
      description: "Read the current shop's permitted discount options.",
      inputSchema: {type: "object", properties: {
        limit: {type: "integer", minimum: 1, maximum: 50},
        cursor: {type: ["string", "null"], maxLength: 2048},
      }, additionalProperties: false},
    },
    {
      name: "commerce_get_discount_details",
      description: "Read details for a permitted discount in the current shop.",
      inputSchema: {type: "object", properties: {
        offerId: {type: "string", minLength: 1, maxLength: 128},
      }, required: ["offerId"], additionalProperties: false},
    },
  ];
  for (const [index, descriptor] of commerceDiscountBuiltInDescriptors.entries()) {
    assert.equal(descriptor.name, expected[index].name);
    assert.equal(descriptor.definitionVersion, "2.0.0");
    assert.equal(descriptor.description, expected[index].description);
    assert.deepEqual(descriptor.inputSchema, expected[index].inputSchema);
    assert.deepEqual(Object.keys(descriptor).sort(), ["kind", "name", "definitionVersion", "description", "inputSchema"].sort());
    assert.ok(CommerceBuiltInToolDescriptorSchema.safeParse(descriptor).success);
    assert.ok(compileSubset(descriptor.inputSchema, "input"));
    assert.ok(Object.isFrozen(descriptor.inputSchema));
    const grant = {kind: "BUILT_IN", toolName: descriptor.name, definitionVersion: "2.0.0"};
    assert.ok(CommerceBuiltInToolGrantSchema.safeParse(grant).success);
    assert.equal(CommerceBuiltInToolGrantSchema.safeParse({...grant, definitionVersion: "1.0.0"}).success, false);
    assert.equal(CommerceBuiltInToolDescriptorSchema.safeParse({...descriptor, definitionVersion: "1.0.0"}).success, false);
    assert.equal(CommerceBuiltInToolGrantSchema.safeParse({...grant, contractHash: "0".repeat(64)}).success, false);
    assert.equal(CommerceBuiltInToolDescriptorSchema.safeParse({...descriptor, contractHash: "0".repeat(64)}).success, false);
  }
});
test("mixed manifest/grants retain published provenance and exactly the trusted built-in set", () => {
  const manifest = exampleManifest(digest, true);
  manifest.builtInTools = structuredClone([...commerceDiscountBuiltInDescriptors]);
  manifest.grantedTools = deduplicateTools(manifest.capabilities, manifest.builtInTools);
  const grant = exampleGrant(manifest);
  assert.ok(CommerceManifestSchema.safeParse(manifest).success);
  assert.ok(CommerceConversationGrantSchema.safeParse(grant).success);
  assert.ok(manifestMatchesGrant(manifest, grant));
  assert.equal(currentlyGrantedTools(grant, new Set(manifest.selectedCapabilityKeys), new Set([exampleTool.toolId])).length, 1);
  assert.equal(currentlyGrantedTools(grant, new Set(manifest.selectedCapabilityKeys), new Set([exampleTool.toolId]), manifest.builtInTools).length, 3);
  const old = {...manifest}; delete (old as Partial<typeof manifest>).builtInTools;
  assert.equal(CommerceManifestSchema.safeParse(old).success, false); // retained built-ins require their descriptor set
  const empty = exampleManifest(digest); delete (empty as Partial<typeof empty>).builtInTools;
  assert.deepEqual(CommerceManifestSchema.parse(empty).builtInTools, []);
  const builtin = grant.grantedTools.find(isBuiltInTool)!;
  assert.equal(CommerceBuiltInToolGrantSchema.safeParse({...builtin, toolId: "fake"}).success, false);
  assert.equal(CommerceBuiltInToolGrantSchema.safeParse({...builtin, capabilityKeys: ["extra"]}).success, false);
  for (const patch of [{contractHash: "0".repeat(64)}, {toolName: "unexpected"}, {definitionVersion: "1.0.0"}]) {
    const changed = structuredClone(grant);
    changed.grantedTools = changed.grantedTools.map(tool => isBuiltInTool(tool) ? {...tool, ...patch} as typeof tool : tool);
    assert.equal(CommerceConversationGrantSchema.safeParse(changed).success, false);
    assert.equal(manifestMatchesGrant(manifest, changed), false);
  }
  assert.equal(GrantedToolsSchema.safeParse([...grant.grantedTools, builtin]).success, false);
  const collision = structuredClone(manifest);
  collision.capabilities[0].toolDescriptor.name = builtin.toolName;
  collision.grantedTools[0] = {...collision.grantedTools.find(tool => !isBuiltInTool(tool))!, toolName: builtin.toolName};
  assert.equal(CommerceManifestSchema.safeParse(collision).success, false);
  assert.throws(() => deduplicateTools(Array.from({length: 32}, (_, i) => ({
    key: "cap-" + i, toolDescriptor: {...exampleTool, toolId: "tool-" + i, toolRevisionId: "rev-" + i, name: "tool_" + i},
  })), commerceDiscountBuiltInDescriptors));
});

export const shipping = {
  provider: "SHOPIFY", observedAt: "2026-11-04T00:00:00.000Z",
  product: {status: "NOT_REQUESTED", productId: null, variantId: null,
    requiresShipping: null, virtual: null, weight: null, dimensions: null,
    shippingClassId: null, shippingClassSlug: null},
  policy: {status: "SCOPE_NOT_GRANTED", trust: "UNTRUSTED_REFERENCE", title: null,
    bodyStatus: "NOT_AVAILABLE", bodyHtml: null, url: null, updatedAt: null},
};
test("browse and shipping requests stay flat, bounded and service-neutral", () => {
  assert.equal(CommerceToolInputs.commerce_search_products.parse({browse: true}).query, null);
  assert.ok(CommerceToolInputs.commerce_search_products.safeParse({browse: true, query: "coat",
    category: {system: "WOOCOMMERCE_PRODUCT_CATEGORY", id: "1", taxonomyVersion: null}}).success);
  assert.deepEqual(CommerceShippingInformationInputSchema.parse({}), {productId: null, variantId: null});
  assert.equal(CommerceToolInputs.commerce_get_shipping_information, CommerceShippingInformationInputSchema);
  assert.ok(CommerceShippingInformationInputSchema.safeParse({variantId: "variation"}).success);
  for (const patch of [{productId: ""}, {variantId: "x".repeat(129)}, {productId: 1},
    ...["destination", "cart", "query", "scope", "shopId", "token", "url"].map(key => ({[key]: "injected"}))])
    assert.equal(CommerceShippingInformationInputSchema.safeParse(patch).success, false);
});
test("shipping has required nullable facts and independent bounded product/policy outcomes", () => {
  assert.equal(CommerceToolOutputs.commerce_get_shipping_information, CommerceShippingInformationSchema);
  for (const provider of ["SHOPIFY", "WOOCOMMERCE"])
    for (const status of ["NOT_REQUESTED", "VARIANT_REQUIRED", "AVAILABLE"])
      for (const policyStatus of ["AVAILABLE", "NOT_CONFIGURED", "SCOPE_NOT_GRANTED", "UNSUPPORTED"])
        assert.ok(CommerceShippingInformationSchema.safeParse({...shipping, provider,
          product: {...shipping.product, status}, policy: {...shipping.policy, status: policyStatus}}).success);
  const measured = {...shipping, product: {...shipping.product, productId: "p", variantId: "v",
    weight: {value: 0, unit: null}, dimensions: {length: 0, width: null, height: 1, unit: null}}};
  assert.ok(CommerceShippingInformationSchema.safeParse(measured).success);
  for (const patch of [{weight: {value: Infinity, unit: null}}, {weight: {value: -1, unit: "GRAMS"}},
    {weight: {value: 1, unit: "CM"}}, {dimensions: {length: NaN, width: null, height: null, unit: null}},
    {dimensions: {length: -1, width: null, height: null, unit: null}},
    {dimensions: {length: 1, width: null, height: null, unit: "x".repeat(17)}},
    {productId: ""}, {shippingClassId: "x".repeat(129)}, {shippingClassSlug: "x".repeat(513)}, {rate: 1}])
    assert.equal(CommerceShippingInformationSchema.safeParse({...shipping, product: {...shipping.product, ...patch}}).success, false);
  for (const patch of [{title: ""}, {title: "x".repeat(513)}, {bodyHtml: ""}, {bodyHtml: "x".repeat(8001)},
    {url: "http://store.test/policy"}, {url: "https://store.test/" + "x".repeat(2048)},
    {trust: "TRUSTED"}, {bodyStatus: "UNKNOWN"}, {updatedAt: "not-a-timestamp"}, {deliveryDays: 1}])
    assert.equal(CommerceShippingInformationSchema.safeParse({...shipping, policy: {...shipping.policy, ...patch}}).success, false);
  // UTF-8 budget, host verification and status/payload relationships remain service policy.
  assert.ok(CommerceShippingInformationSchema.safeParse({...shipping,
    policy: {...shipping.policy, bodyHtml: "界".repeat(8000), url: "https://unverified.example/policy"}}).success);
  for (const object of [shipping, shipping.product, shipping.policy]) {
    for (const key of Object.keys(object)) {
      const omitted = structuredClone(shipping) as any;
      const target = object === shipping ? omitted : object === shipping.product ? omitted.product : omitted.policy;
      delete target[key];
      assert.equal(CommerceShippingInformationSchema.safeParse(omitted).success, false, key);
    }
  }
  assert.equal(CommerceShippingInformationSchema.safeParse({...shipping, extra: true}).success, false);
});
test("presentation selection owns optional identifiers, leaving relationships to the host", () => {
  const schema = CommerceAnswerPresentationSelectionSchema;
  assert.deepEqual(schema.parse({}), {});
  for (const responseDisposition of CommerceResponseDispositionSchema.options)
    assert.ok(schema.safeParse({responseDisposition, shippingInformationSelection: {productId: null, variantId: null}}).success);
  assert.ok(schema.safeParse({shippingInformationSelection: {productId: null, variantId: "v"}}).success);
  for (const value of [{responseDisposition: "OTHER"}, {shippingInformationSelection: {}},
    {shippingInformationSelection: {productId: "", variantId: null}},
    {shippingInformationSelection: {productId: null, variantId: "x".repeat(129)}},
    {shippingInformationSelection: {productId: null, variantId: null, url: "https://store.test"}},
    ...["replyText", "amount", "url", "evidenceIds", "scope", "deliveryDays"].map(key => ({[key]: "invented"}))])
    assert.equal(schema.safeParse(value).success, false);
  const composed = CommerceProductRecommendationSelectionSchema.extend({...schema.shape, unrelated: z.string().max(20).optional()});
  assert.ok(composed.safeParse({...recommendation, responseDisposition: "STANDARD", unrelated: "retained"}).success);
  // Existing exact-get/search outputs are unchanged, including rejection of new presentation fields.
  assert.deepEqual(CommerceToolOutputs.commerce_get_product.parse({product: null}), {product: null});
  const empty = {products: [], cursor: null, truncated: false};
  assert.deepEqual(CommerceToolOutputs.commerce_search_products.parse(empty), empty);
  assert.equal(CommerceToolOutputs.commerce_search_products.safeParse({...empty, browse: true}).success, false);
});

const timestampOffer = {
  offerId: "offer-fixture", title: "Fixture", method: "CODE", code: null,
  startsAt: null, endsAt: null, support: "SUPPORTED", reasonCodes: [],
};
const timestampFacts = {
  provider: "SHOPIFY", completeness: "UNKNOWN", observedAt: "2026-11-04T10:00:00Z",
  providerStatus: "ACTIVE", unavailableAt: null, discountKind: "UNKNOWN",
  discountValue: null, discountCurrency: null,
  targeting: {kind: "UNKNOWN", includedProductIds: [], includedVariantIds: [],
    includedCategoryIds: [], includedCollectionIds: [], excludedProductIds: [],
    excludedVariantIds: [], excludedCategoryIds: [], excludedCollectionIds: []},
  minimumSubtotal: null, maximumSubtotal: null, subtotalRequirementCurrency: null,
  minimumQuantity: null, usageLimit: null, usageCount: null, perCustomerLimit: null,
  customerScope: "UNKNOWN", excludesSaleItems: null, individualUse: null,
  combination: {discountClasses: null, shopifyPlus: null, combinesWith: null,
    discountTags: null, allowedSameLineProductTags: null},
  unrepresentedConditions: [],
};
const acceptedDiscountTimestamps = [
  "2026-11-04T10:00:00Z", "2026-11-04T10:00:00.1Z", "2026-11-04T10:00:00.12Z",
  "2026-11-04T10:00:00.123Z", "2026-11-04T10:00:00.1234567890Z",
  "2024-02-29T23:59:59Z", "2000-02-29T00:00:00Z", "2400-02-29T00:00:00Z",
  "0099-01-01T00:00:00Z", "9999-12-31T23:59:59Z",
];
const rejectedDiscountTimestamps = [
  "2026-11-04T10:00Z", "2026-11-04T10:00:00+00:00", "2026-02-30T10:00:00Z",
  "2026-11-04T10:00:60Z", "2026-11-04T10:00:00z", "2026-11-04t10:00:00Z",
  " 2026-11-04T10:00:00Z", "2026-11-04T10:00:00Z ", "2026-11-04T10:00:00Z\n",
  "2026-11-04T10:00:00.Z", "2026-11-04T10:00:00", "2026-11-04T10:00:00-01:00",
  "2026-11-04T24:00:00Z", "2026-11-04T10:60:00Z", "2026-00-04T10:00:00Z",
  "2026-13-04T10:00:00Z", "2026-11-00T10:00:00Z", "2026-04-31T10:00:00Z",
  "1900-02-29T10:00:00Z", "2100-02-29T10:00:00Z", "2026-02-29T10:00:00Z",
  "2026-1-04T10:00:00Z", "2026-11-04T1:00:00Z", "10000-11-04T10:00:00Z",
  "2026-11-04T10:00:00.1e2Z", "2026-11-04T10:00:00Zsuffix",
];
for (const [expected, values] of [[true, acceptedDiscountTimestamps], [false, rejectedDiscountTimestamps]] as const) {
  for (const value of values) test(`discount UTC timestamp ${expected ? "PASS" : "FAIL"} ${JSON.stringify(value)}`, () => {
    for (const field of ["startsAt", "endsAt"]) {
      const offer = {...timestampOffer, [field]: value};
      assert.equal(CommerceOfferSchema.safeParse(offer).success, expected, field);
      assert.equal(CommerceToolOutputs.commerce_get_discount_options.safeParse({
        mode: "FIXED", offers: [offer], truncated: false,
      }).success, expected, `options.${field}`);
      assert.equal(CommerceToolOutputs.commerce_get_discount_details.safeParse({
        details: {offer, facts: timestampFacts, providerDiscountId: null},
      }).success, expected, `details.${field}`);
    }
    for (const field of ["observedAt", "unavailableAt"]) {
      const facts = {...timestampFacts, [field]: value};
      assert.equal(CommerceDiscountConditionFactsSchema.safeParse(facts).success, expected, field);
      assert.equal(CommerceToolOutputs.commerce_get_discount_details.safeParse({
        details: {offer: timestampOffer, facts, providerDiscountId: null},
      }).success, expected, `details.facts.${field}`);
    }
  });
}
test("discount timestamps preserve nullable fields, original wire bytes and offer ordering", () => {
  assert.deepEqual(CommerceOfferSchema.parse(timestampOffer), timestampOffer);
  assert.deepEqual(CommerceDiscountConditionFactsSchema.parse(timestampFacts), timestampFacts);
  const startsAt = "2026-11-04T10:00:00.1234567890Z";
  const endsAt = "2026-11-04T10:00:01.1234567890Z";
  const ordered = {...timestampOffer, startsAt, endsAt};
  assert.deepEqual(CommerceOfferSchema.parse(ordered), ordered);
  for (const [start, end] of [[endsAt, startsAt], [startsAt, startsAt]])
    assert.equal(CommerceOfferSchema.safeParse({...timestampOffer, startsAt: start, endsAt: end}).success, false);
  assert.equal(CommerceDiscountConditionFactsSchema.safeParse({...timestampFacts, observedAt: null}).success, false);
});
