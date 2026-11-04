import test from "node:test";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {join} from "node:path";
import {z} from "zod";
import {CommerceToolInputs, CommerceToolOutputs, CommerceProductRecommendationSelectionSchema, CommerceAnswerPresentationSelectionSchema} from "./schemas";
import {commerceDiscountBuiltInDescriptors} from "./built-in-tools";
import {compileSubset, validateSubset, type SubsetSchema} from "./subset";
import {CommerceToolDraftDefinitionSchema} from "./definitions";
import {CommerceResponseContractSchema, EMPTY_RESPONSE_CONTRACT} from "./response";

// Explicit test-only integration with the existing Commerce owner, without linking/upgrading its package.
// Its projector receives actual candidate Shared validators as function arguments.
const root = process.env.COMMERCE_CONTRACT_SOURCE_ROOT;
test("actual Commerce projector and publication accept generated discovery inputs and recommendation details", {skip: !root}, async () => {
  const authoring = await import(pathToFileURL(join(root!, "src/commerce/execution/policy-operation-authoring.ts")).href);
  const rendering = await import(pathToFileURL(join(root!, "src/commerce/execution/policy-result-schema.ts")).href);
  const publication = await import(pathToFileURL(join(root!, "src/commerce/tool-definition/publication.ts")).href);
  const project = (inputValidator: z.ZodType, outputValidator: z.ZodType, operation = "products.search") => authoring.createPolicyOperationAuthoringDescriptor({
    operation, operationVersion: "1.0.0", displayName: "Test input", description: "Synthetic contract fixture",
    inputValidator, outputValidator,
  }) as {argumentsSchema: SubsetSchema; resultSchema: SubsetSchema};
  for (const [name, operation] of [
    ["commerce_resolve_product_categories", "taxonomy.resolveCategories"],
    ["commerce_search_products", "products.search"],
    ["commerce_get_shipping_information", "shipping.getInformation"],
  ] as const) {
    const projected = project(CommerceToolInputs[name], CommerceToolOutputs[name], operation);
    assert.ok(validateSubset(projected.argumentsSchema, "input"), JSON.stringify(projected.argumentsSchema));
    const definition = {
      name, definitionVersion: "1.0.0", description: "Read current-shop discovery facts.",
      inputSchema: projected.argumentsSchema,
      execution: {kind: "POLICY_OPERATION", operation, operationVersion: "1.0.0", arguments: {}},
      responseTemplate: {kind: "nunjucks", runtimeVersion: "nunjucks.v1", source: "Products.", unavailable: "Unavailable."},
    };
    assert.ok(CommerceToolDraftDefinitionSchema.safeParse(definition).success);
    // The installed Commerce baseline still uses released Shared's operation registry.
    // Validate candidate operation metadata above, then its actual publication/input path
    // with a registered operation; consumer registry adoption belongs to Commerce after release.
    assert.ok(publication.validateDefinitionForPublication({...definition,
      execution: {...definition.execution, operation: "products.search"},
    }, {
      compile: () => ({outputSchema: rendering.policySchemaFromJson(projected.resultSchema), validateMappedArguments: () => true}),
    }));
    assert.equal(JSON.stringify(projected.argumentsSchema).includes('"const"'), false);
    assert.equal(JSON.stringify(projected.argumentsSchema).includes('"oneOf"'), false);
  }
  for (const descriptor of commerceDiscountBuiltInDescriptors)
    assert.deepEqual(project(CommerceToolInputs[descriptor.name], CommerceToolOutputs[descriptor.name]).argumentsSchema, descriptor.inputSchema);
  const details = project(CommerceToolInputs.commerce_search_products, CommerceProductRecommendationSelectionSchema.extend({...CommerceAnswerPresentationSelectionSchema.shape, unrelated: z.string().max(20).optional()})).resultSchema;
  assert.ok(CommerceResponseContractSchema.safeParse({...EMPTY_RESPONSE_CONTRACT, detailsSchema: details}).success);
  const compiled = compileSubset(details, "details");
  const entry = {scope: "PRODUCT_ONLY", basketLineId: null, productId: "product", variantId: null, quantity: 1, promotionKind: "DISCOUNT", offerIds: ["offer"]};
  assert.ok(compiled.safeParse({productRecommendationVersion: "1", productRecommendations: [entry]}).success);
  assert.ok(compiled.safeParse({}).success);
  assert.ok(compiled.safeParse({productRecommendationVersion: "1", productRecommendations: [entry],
    responseDisposition: "STANDARD", shippingInformationSelection: {productId: null, variantId: null}, unrelated: "retained"}).success);
  assert.equal(compiled.safeParse({responseDisposition: "OTHER"}).success, false);
  assert.equal(compiled.safeParse({shippingInformationSelection: {productId: null, variantId: null, cost: 1}}).success, false);
  assert.equal(compiled.safeParse({shippingInformationSelection: {productId: null}}).success, false);
  assert.ok(compileSubset(project(CommerceToolInputs.commerce_get_shipping_information, CommerceToolOutputs.commerce_get_shipping_information).argumentsSchema, "input").safeParse({productId: null, variantId: null}).success);
  assert.equal(compiled.safeParse({productRecommendations: [{...entry, amount: "4"}]}).success, false);
  assert.equal(validateSubset({...details, oneOf: []}, "details"), false);
  assert.equal(validateSubset({...details, const: {}}, "details"), false);
  const deeper = structuredClone(details);
  deeper.properties!.productRecommendations.items!.properties!.offerIds.items = {
    type: "array", maxItems: 1, items: {type: "string", maxLength: 128},
  };
  assert.equal(validateSubset(deeper, "details"), false);
  assert.equal(validateSubset(details, "input"), false);
  const depthFourInput = project(z.strictObject({outer: z.strictObject({inner: z.strictObject({
    id: z.string().max(128),
  })})}), CommerceToolOutputs.commerce_search_products).argumentsSchema;
  assert.equal(validateSubset(depthFourInput, "input"), false);
  const unbounded = structuredClone(details);
  delete unbounded.properties!.productRecommendations.items!.properties!.productId.maxLength;
  assert.equal(validateSubset(unbounded, "details"), false);
  assert.equal(compiled.safeParse({productRecommendations: [{...entry, productId: "x".repeat(17000)}]}).success, false);
  // Nullable objects/arrays, unlike nullable detail scalars, remain unsupported.
  assert.equal(validateSubset({type: "object", properties: {x: {type: ["object", "null"], properties: {}, additionalProperties: false}}, additionalProperties: false}, "details"), false);
});
