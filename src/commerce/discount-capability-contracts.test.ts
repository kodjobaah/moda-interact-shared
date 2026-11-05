import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CommerceExecutionSchema,
  CommerceToolInputs,
  CommerceToolOutputs,
  CommerceBuiltInToolGrantSchema,
  CommerceManifestSchema,
  CommerceConversationGrantSchema,
  POLICY_OPERATIONS,
  validateDefinitionVersion,
} from "./index";
import { DISCOUNT_POLICY_OPERATION_DESCRIPTORS } from "./discount-capability-contracts";
import { commerceDiscountBuiltInDescriptors } from "./built-in-tools";
import { deduplicateTools, selectCapabilities, currentlyGrantedTools, manifestMatchesGrant } from "./selection";
import { isBuiltInTool } from "./definitions";
import { exampleManifest, exampleGrant } from "./fixtures";
import type { PublishedToolDescriptor } from "./definitions";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function publishedDiscountManifest(name: string): ReturnType<typeof exampleManifest> {
  const manifest = exampleManifest(digest);
  const descriptor: PublishedToolDescriptor = {
    toolId: `tool_${name}`,
    toolRevisionId: `revision_${name}`,
    name,
    definitionVersion: "1.0.0",
    description: `Published ${name} contract`,
    inputSchema: name === "commerce_get_discount_options"
      ? {type: "object", properties: {
          limit: {type: "integer", minimum: 1, maximum: 50},
          cursor: {type: ["string", "null"], maxLength: 2048},
        }, additionalProperties: false}
      : {type: "object", properties: {offerId: {type: "string", minLength: 1, maxLength: 128}}, required: ["offerId"], additionalProperties: false},
  };
  manifest.capabilities = [{capabilityId: "cap_discount", key: "product_search", featureId: "feature_product_search", position: 0, toolDescriptor: descriptor}];
  manifest.selectedCapabilityKeys = ["product_search"];
  manifest.featureBehaviours = [{featureId: "feature_product_search", behaviourPrompt: ""}];
  manifest.grantedTools = [{toolId: descriptor.toolId, toolRevisionId: descriptor.toolRevisionId,
    toolName: descriptor.name, definitionVersion: descriptor.definitionVersion, capabilityKeys: ["product_search"]}];
  return manifest;
}

test("canonical discount operation descriptors use the existing validators and exact operation identities", () => {
  assert.deepEqual(DISCOUNT_POLICY_OPERATION_DESCRIPTORS.map(({toolName, displayName, operation, operationVersion}) =>
    ({toolName, displayName, operation, operationVersion})), [
      {toolName: "commerce_get_discount_options", displayName: "Get Discount Options", operation: "discounts.getOptions", operationVersion: "1.0.0"},
      {toolName: "commerce_get_discount_details", displayName: "Get Discount Details", operation: "discounts.getDetails", operationVersion: "1.0.0"},
    ]);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS[0].inputValidator, CommerceToolInputs.commerce_get_discount_options);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS[0].outputValidator, CommerceToolOutputs.commerce_get_discount_options);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS[1].inputValidator, CommerceToolInputs.commerce_get_discount_details);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS[1].outputValidator, CommerceToolOutputs.commerce_get_discount_details);
  assert.ok(POLICY_OPERATIONS.includes("discounts.getDetails"));
  assert.ok(CommerceExecutionSchema.safeParse({kind: "POLICY_OPERATION", operation: "discounts.getDetails", operationVersion: "1.0.0", arguments: {offerId: {input: "offerId"}}}).success);
  assert.equal(CommerceExecutionSchema.safeParse({kind: "POLICY_OPERATION", operation: "discounts.getDetails", operationVersion: "2.0.0", arguments: {}}).success, false);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS[0].inputValidator.safeParse({limit: 10, shopId: "forged"}).success, false);
  assert.equal(DISCOUNT_POLICY_OPERATION_DESCRIPTORS.some(({toolName, operation}) => toolName === "commerce_get_discount_details" && String(operation) === "discounts.evaluate"), false);
  assert.equal(validateDefinitionVersion("1.0.0", null), true);
  assert.equal(validateDefinitionVersion("1.0.0", "2.0.0"), false);
  assert.equal(validateDefinitionVersion("2.0.1", "2.0.0"), true);
});

test("old discount option results and current condition facts retain their wire meaning", () => {
  const previousOptions = {mode: "NONE", offers: [], truncated: false};
  assert.deepEqual(CommerceToolOutputs.commerce_get_discount_options.parse(previousOptions), previousOptions);

  const currentFacts = {
    provider: "SHOPIFY", completeness: "UNKNOWN", observedAt: "2026-11-04T10:00:00.1234567890Z",
    providerStatus: "ACTIVE", unavailableAt: null, discountKind: "UNKNOWN", discountValue: null,
    discountCurrency: null,
    targeting: {kind: "UNKNOWN", includedProductIds: [], includedVariantIds: [], includedCategoryIds: [], includedCollectionIds: [],
      excludedProductIds: [], excludedVariantIds: [], excludedCategoryIds: [], excludedCollectionIds: []},
    minimumSubtotal: null, maximumSubtotal: null, subtotalRequirementCurrency: null, minimumQuantity: null,
    usageLimit: null, usageCount: null, perCustomerLimit: null, customerScope: "UNKNOWN",
    excludesSaleItems: null, individualUse: null,
    combination: {discountClasses: null, shopifyPlus: null, combinesWith: null, discountTags: null, allowedSameLineProductTags: null},
    unrepresentedConditions: [],
  };
  const currentDetails = {details: {offer: {offerId: "offer-current", title: "Current", method: "CODE", code: null,
    startsAt: null, endsAt: null, support: "SUPPORTED", reasonCodes: []}, facts: currentFacts, providerDiscountId: null}};
  assert.deepEqual(CommerceToolOutputs.commerce_get_discount_details.parse(currentDetails), currentDetails);
  assert.equal(CommerceToolOutputs.commerce_get_discount_details.safeParse({details: {...currentDetails.details, facts: {...currentFacts, observedAt: "not-a-timestamp"}}}).success, false);
});

test("active product_search mappings preserve Free and paid active-plan access while disabled boundaries deny", () => {
  const capability = {key: "product_search", featureId: "feature_product_search", enabled: true, position: 0};
  for (const plan of ["Free", "Paid"]) {
    assert.deepEqual(selectCapabilities([capability], {features: [{id: "feature_product_search", active: true,
      planMappingEnabled: true, mode: "ALWAYS_ENABLED", preferenceEnabled: null}]}), ["product_search"], plan);
  }
  for (const facts of [
    {active: false, planMappingEnabled: true},
    {active: true, planMappingEnabled: false},
  ]) {
    assert.deepEqual(selectCapabilities([capability], {features: [{id: "feature_product_search", ...facts,
      mode: "ALWAYS_ENABLED", preferenceEnabled: null}]}), []);
  }
  const manifest = publishedDiscountManifest("commerce_get_discount_options");
  const grant = exampleGrant(manifest);
  assert.ok(CommerceManifestSchema.safeParse(manifest).success);
  assert.ok(CommerceConversationGrantSchema.safeParse(grant).success);
  assert.equal(currentlyGrantedTools(grant, new Set(["product_search"]), new Set(["tool_commerce_get_discount_options"])).length, 1);
  assert.equal(currentlyGrantedTools(grant, new Set(), new Set(["tool_commerce_get_discount_options"])).length, 0);
  assert.equal(currentlyGrantedTools(grant, new Set(["product_search"]), new Set()).length, 0);
});

test("stale revisions, duplicate names and legacy-only grants fail closed for published membership", () => {
  const manifest = publishedDiscountManifest("commerce_get_discount_details");
  const grant = exampleGrant(manifest);
  const changedRevision = structuredClone(manifest);
  changedRevision.capabilities[0].toolDescriptor.toolRevisionId = "revision_newer";
  const changedGrant = changedRevision.grantedTools[0];
  if (isBuiltInTool(changedGrant)) assert.fail("expected a published discount grant");
  changedGrant.toolRevisionId = "revision_newer";
  assert.ok(CommerceManifestSchema.safeParse(changedRevision).success);
  assert.equal(manifestMatchesGrant(changedRevision, grant), false);

  assert.throws(() => deduplicateTools(manifest.capabilities.map(capability => ({key: capability.key, toolDescriptor: capability.toolDescriptor})), commerceDiscountBuiltInDescriptors));
  const historicalBuiltIn = {kind: "BUILT_IN" as const, toolName: "commerce_get_discount_details", definitionVersion: "2.0.0" as const};
  assert.ok(CommerceBuiltInToolGrantSchema.safeParse(historicalBuiltIn).success);
  const legacyManifest = exampleManifest(digest, true);
  legacyManifest.capabilities = [];
  legacyManifest.selectedCapabilityKeys = [];
  legacyManifest.featureBehaviours = [];
  legacyManifest.builtInTools = [commerceDiscountBuiltInDescriptors[1]];
  legacyManifest.grantedTools = deduplicateTools([], [commerceDiscountBuiltInDescriptors[1]]);
  const legacyGrant = exampleGrant(legacyManifest);
  assert.ok(CommerceManifestSchema.safeParse(legacyManifest).success);
  assert.equal(currentlyGrantedTools(legacyGrant, new Set(["product_search"]), new Set(), []).length, 0);
});
