import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {z} from "zod";
import {
  CommerceCategoryCandidateSchema, CommerceCategoryResolutionSchema,
  CommerceConversationToolContextSchema, CommerceProductRecommendationSelectionSchema,
  CommerceOptionalLookupUnavailableSchema, CommerceToolInputs, CommerceToolOutputs,
  CommerceManifestSchema, CommerceConversationGrantSchema,
} from "./schemas";
import {
  CommerceBuiltInToolDescriptorSchema, CommerceBuiltInToolGrantSchema,
  GrantedToolsSchema, isBuiltInTool,
} from "./definitions";
import {commerceDiscountBuiltInDescriptors, commerceBuiltInToolContractPayload} from "./built-in-tools";
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
  assert.deepEqual(schema.parse({}), {query: null, availableOnly: true, limit: 10, cursor: null});
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
test("trusted conversation context and recommendation fields are structural and identifier-only", () => {
  assert.ok(CommerceConversationToolContextSchema.safeParse({purpose: "CONVERSATION", conversationId: "conversation", inboundVersion: 1, grantId: null}).success);
  assert.equal(CommerceConversationToolContextSchema.safeParse({purpose: "CONVERSATION", conversationId: "conversation", inboundVersion: 0, grantId: null}).success, false);
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
test("built-in constants hash exact schemas and their bounded input contracts are immutable", () => {
  for (const descriptor of commerceDiscountBuiltInDescriptors) {
    assert.ok(CommerceBuiltInToolDescriptorSchema.safeParse(descriptor).success);
    assert.equal(digest(commerceBuiltInToolContractPayload(descriptor)), descriptor.contractHash);
    assert.ok(compileSubset(descriptor.inputSchema, "input"));
    assert.ok(Object.isFrozen(descriptor.inputSchema));
    const output = JSON.parse(commerceBuiltInToolContractPayload(descriptor)).outputSchema;
    assert.deepEqual(output, z.toJSONSchema(CommerceToolOutputs[descriptor.name], {io: "output", unrepresentable: "any"}));
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
  for (const patch of [{contractHash: "0".repeat(64)}, {toolName: "unexpected"}, {definitionVersion: "2.0.0"}]) {
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
