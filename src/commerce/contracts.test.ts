import {
  definitionStorageBytes,
  DEFINITION_SIZE_MESSAGE,
} from "./definition-size";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CommerceToolDefinitionSchema,
  CommerceToolDraftDefinitionSchema,
  mapToolArguments,
  validateDefinitionForPublication,
  type CommerceDefinitionCompiler,
} from "./definitions";
import {
  CommerceResponseContractSchema,
  finalResponseSchema,
  verifyResponseContract,
  EMPTY_RESPONSE_CONTRACT,
} from "./response";
import { canonicalJson, responseContractCanonicalJson } from "./canonical-json";
import {
  CommerceManifestSchema,
  CommerceConversationGrantSchema,
  CommerceTurnIdentitySchema,
  CommerceAssertionSchema,
  CommerceToolInputs,
  CommerceToolOutputs,
  CommerceEvidenceSchema,
  CommerceProductSchema,
  CommerceProductSaleEvidenceSchema,
  CommerceDiscountConditionFactsSchema,
  CommerceDiscountDetailsSchema,
  commerceToolResultSchema,
  CommerceFinalResponseSchema,
  CommerceOutreachToolContextSchema,
  type CommerceDiscountConditionFacts,
  type CommerceDiscountDetails,
  type CommerceOutreachToolContext,
} from "./index";
import {
  validateSubset,
  MONEY_PATTERN,
  compileSubset,
  InputSchemaSchema,
  type SubsetSchema,
} from "./subset";
import {
  selectCapabilities,
  deduplicateTools,
  currentlyGrantedTools,
} from "./selection";
import {
  exampleDefinition,
  exampleFinal,
  exampleManifest,
  exampleGrant,
  exampleTool,
  exampleTurn,
} from "./fixtures";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const ok = (
  s: { safeParse: (v: unknown) => { success: boolean } },
  v: unknown,
) => assert.equal(s.safeParse(v).success, true);
const bad = (
  s: { safeParse: (v: unknown) => { success: boolean } },
  v: unknown,
) => assert.equal(s.safeParse(v).success, false);
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
test("outreach tool context is strict and requires recovery-attempt identity", () => {
  const context = {
    purpose: "INITIAL_RECOVERY_OUTREACH",
    checkoutRecoveryId: "recovery_456",
    outreachAttemptId: "attempt_789",
  } satisfies CommerceOutreachToolContext;

  ok(CommerceOutreachToolContextSchema, context);
  bad(CommerceOutreachToolContextSchema, { ...context, shopId: "model_forged_shop" });
  bad(CommerceOutreachToolContextSchema, { ...context, purpose: "CONVERSATION" });
  const { outreachAttemptId: _missingAttemptId, ...missingAttempt } = context;
  bad(CommerceOutreachToolContextSchema, missingAttempt);
});

test("canonical JSON rejects undefined, cycles, nonfinite and sparse data; C4 and RFC8785 ordering are explicit", () => {
  assert.equal(canonicalJson({ b: 2, a: [3, 1] }), '{"a":[3,1],"b":2}');
  for (const v of [
    { a: undefined },
    NaN,
    Infinity,
    new Date(),
    new Array(2),
    "\ud800",
  ])
    assert.throws(() => canonicalJson(v));
  const cycle: { v?: unknown } = {};
  cycle.v = cycle;
  assert.throws(() => canonicalJson(cycle));
  const value = { "\u{10000}": 1, "\ue000": 2 };
  assert.notEqual(canonicalJson(value), responseContractCanonicalJson(value));
});

test("R04/R05/R12: reject incompatible schema, envelope edits, missing/wrong hashes and excessive bytes", () => {
  for (const detailsSchema of [
    {
      ...EMPTY_RESPONSE_CONTRACT.detailsSchema,
      $ref: "https://untrusted.test",
    },
    { ...EMPTY_RESPONSE_CONTRACT.detailsSchema, pattern: ".*" },
    {
      ...EMPTY_RESPONSE_CONTRACT.detailsSchema,
      properties: { x: { type: "string" } },
    },
  ])
    bad(CommerceResponseContractSchema, {
      ...EMPTY_RESPONSE_CONTRACT,
      detailsSchema,
    });
  bad(CommerceResponseContractSchema, {
    ...EMPTY_RESPONSE_CONTRACT,
    replyText: { type: "number" },
  });
  assert.throws(() =>
    verifyResponseContract(EMPTY_RESPONSE_CONTRACT, "b".repeat(64), digest),
  );
  assert.deepEqual(
    verifyResponseContract(
      EMPTY_RESPONSE_CONTRACT,
      digest(responseContractCanonicalJson(EMPTY_RESPONSE_CONTRACT)),
      digest,
    ),
    EMPTY_RESPONSE_CONTRACT,
  );
  let deep: SubsetSchema = { type: "string", maxLength: 10 };
  for (let i = 0; i < 5; i++)
    deep = {
      type: "object",
      properties: { child: deep },
      required: [],
      additionalProperties: false,
    };
  assert.equal(validateSubset(deep, "details"), false);
  bad(CommerceResponseContractSchema, {
    ...EMPTY_RESPONSE_CONTRACT,
    instructions: "a".repeat(8001),
  });
});
test("C14 structural drafts are not publishable; never-seeded query definitions and exact decimal inputs", () => {
  ok(CommerceToolDraftDefinitionSchema, {
    ...exampleDefinition,
    inputSchema: {},
    execution: {},
    responseTemplate: {},
  });
  bad(CommerceToolDefinitionSchema, {
    ...exampleDefinition,
    inputSchema: {},
    execution: {},
    responseTemplate: {},
  });
  ok(CommerceToolDefinitionSchema, exampleDefinition);
  const money: SubsetSchema = {
    type: "object",
    properties: {
      maximumPrice: { type: "string", maxLength: 25, pattern: MONEY_PATTERN },
    },
    required: [],
    additionalProperties: false,
  };
  const schema = compileSubset(money, "input");
  ok(schema, { maximumPrice: "199.123456" });
  bad(schema, { maximumPrice: 199 });
  bad(schema, { maximumPrice: "1e3" });
  bad(schema, { maximumPrice: "1.1234567" });
  for (const patch of [
    { pattern: ".*" },
    { $ref: "#/secret" },
    { default: "x" },
  ])
    assert.equal(
      validateSubset(
        {
          ...money,
          properties: {
            maximumPrice: { ...money.properties!.maximumPrice, ...patch },
          },
        },
        "input",
      ),
      false,
    );
  assert.deepEqual(
    { ...mapToolArguments(exampleDefinition, { handle: "coat" }) },
    { handle: "coat" },
  );
  assert.throws(() =>
    mapToolArguments(exampleDefinition, { handle: "coat", shopId: "foreign" }),
  );
  bad(CommerceToolDefinitionSchema, {
    ...exampleDefinition,
    execution: {
      ...exampleDefinition.execution,
      variables: { handle: { input: "unknown" } },
    },
  });
  bad(CommerceToolDefinitionSchema, {
    ...exampleDefinition,
    definitionVersion: "1.0.0-beta",
  });
  bad(CommerceToolDefinitionSchema, {
    ...exampleDefinition,
    inputSchema: {
      ...exampleTool.inputSchema,
      properties: { shopId: { type: "string", maxLength: 128 } },
      required: [],
    },
  });
});
test("template publication binds result paths to the injected compiler output; no arbitrary expressions", () => {
  const compiler: CommerceDefinitionCompiler = {
    compile: () => ({
      outputSchema: {
        type: "object",
        properties: {
          values: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 100 },
              description: { type: "string", maxLength: 100 },
            },
            required: [],
            additionalProperties: false,
          },
        },
        required: [],
        additionalProperties: false,
      },
      validateMappedArguments: () => true,
    }),
  };
  assert.equal(
    validateDefinitionForPublication(exampleDefinition, compiler).name,
    exampleTool.name,
  );
  assert.throws(() =>
    validateDefinitionForPublication(
      {
        ...exampleDefinition,
        responseTemplate: {
          kind: "text",
          text: "{{result.password}}",
          unavailable: "",
        },
      },
      compiler,
    ),
  );
  for (const text of [
    "{{result.constructor}}",
    "{{result.title.toUpperCase()}}",
    "<script>bad</script>",
  ])
    bad(CommerceToolDefinitionSchema, {
      ...exampleDefinition,
      responseTemplate: { kind: "text", text, unavailable: "" },
    });
});
test("direct Feature selection preserves plan/opt-in policy and permits no selected capabilities", () => {
  const fresh = {
    key: "feature_product_read",
    featureId: "new-feature",
    enabled: true,
    position: 0,
  };
  const featureFacts = {
    features: [{
      id: "new-feature",
      active: true,
      planMappingEnabled: true,
      mode: "MERCHANT_OPT_IN" as const,
      preferenceEnabled: true,
    }],
  };
  assert.deepEqual(selectCapabilities([fresh], featureFacts), ["feature_product_read"]);
  assert.deepEqual(selectCapabilities([{ ...fresh, enabled: false }], { features: [] }), []);
  assert.deepEqual(selectCapabilities([], { features: [] }), []);
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], active: false }],
    }),
    [],
  );
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], planMappingEnabled: false }],
    }),
    [],
  );
  assert.deepEqual(
    selectCapabilities([fresh], {
      features: [{ ...featureFacts.features[0], preferenceEnabled: null }],
    }),
    [],
  );
  assert.throws(() => selectCapabilities([fresh, fresh], featureFacts));
});
test("direct Tool descriptors deduplicate provenance and conflicting associations reject; grants never widen", () => {
  const tools = deduplicateTools([
    { key: "z_feature", toolDescriptor: exampleTool },
    { key: "a_feature", toolDescriptor: exampleTool },
  ]);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].capabilityKeys, ["a_feature", "z_feature"]);
  assert.throws(() =>
    deduplicateTools([
      { key: "a", toolDescriptor: exampleTool },
      {
        key: "b",
        toolDescriptor: { ...exampleTool, toolRevisionId: "different" },
      },
    ]),
  );
  const m = exampleManifest(digest, true);
  ok(CommerceManifestSchema, m);
  const emptyManifest = {
    ...m,
    capabilities: [],
    featureBehaviours: [],
    selectedCapabilityKeys: [],
    grantedTools: [],
  };
  ok(CommerceManifestSchema, emptyManifest);
  const g = exampleGrant(m);
  const emptyGrant = {
    ...exampleGrant(emptyManifest),
    selectedCapabilityKeys: [],
    grantedTools: [],
  };
  ok(CommerceConversationGrantSchema, emptyGrant);
  bad(CommerceManifestSchema, { ...m, featureBehaviours: [] });
  bad(CommerceManifestSchema, {
    ...m,
    featureBehaviours: [{ featureId: "unrepresented", behaviourPrompt: "" }],
  });
  assert.equal(
    currentlyGrantedTools(
      g,
      new Set(["another_capability"]),
      new Set([exampleTool.toolId]),
    ).length,
    0,
  );
  assert.equal(
    currentlyGrantedTools(
      g,
      new Set(["feature_product_read"]),
      new Set([exampleTool.toolId]),
    ).length,
    1,
  );
  bad(CommerceManifestSchema, { ...m, grantedTools: [] });
  bad(CommerceManifestSchema, { ...m, selectedCapabilityKeys: ["other"] });
});
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
test("response schema rejects total-property overflow, duplicates, invalid bounds, unsupported unions and runtime detail overflow", () => {
  const properties = Object.fromEntries(
    Array.from({ length: 33 }, (_, i) => [
      `p${i}`,
      { type: "string", maxLength: 4096 },
    ]),
  );
  for (const schema of [
    { type: "object", properties, required: [], additionalProperties: false },
    {
      type: "object",
      properties: { x: { type: "string", maxLength: 3, minLength: 4 } },
      required: [],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { x: { type: ["string", "null"], maxLength: 3 } },
      required: [],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { x: { type: "string", maxLength: 3, enum: ["a", "a"] } },
      required: [],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        x: { type: "array", maxItems: 21, items: { type: "boolean" } },
      },
      required: [],
      additionalProperties: false,
    },
  ])
    assert.equal(validateSubset(schema, "details"), false);
  const schema: SubsetSchema = {
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `p${i}`,
        { type: "string", maxLength: 4096 },
      ]),
    ),
    required: [],
    additionalProperties: false,
  };
  bad(
    compileSubset(schema, "details"),
    Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`p${i}`, "a".repeat(4096)]),
    ),
  );
});

test("optional required keyword follows JSON Schema semantics; nullable enums still constrain null", () => {
  const schema = {
    type: "object",
    properties: {
      value: { type: ["string", "null"], maxLength: 20, enum: ["yes"] },
    },
    additionalProperties: false,
  };
  assert.equal(InputSchemaSchema.safeParse(schema).success, true);
  assert.equal(
    compileSubset(InputSchemaSchema.parse(schema), "input").safeParse({})
      .success,
    true,
  );
  assert.equal(
    compileSubset(InputSchemaSchema.parse(schema), "input").safeParse({
      value: null,
    }).success,
    false,
  );
});

// Pretty JSON stripped of indentation retains jsonb's separator spaces. These
// boundary fixtures use no exponent numbers, so this is an independent text oracle.
const persistedFixtureText = (value: unknown) =>
  JSON.stringify(value, null, 1).replace(/,\n */g, ", ").replace(/\n */g, "");
test("R1 draft and strict whole definitions honor jsonb byte boundaries", () => {
  for (const strict of [false, true])
    for (const multibyte of [false, true]) {
      const schema = strict
        ? CommerceToolDefinitionSchema
        : CommerceToolDraftDefinitionSchema;
      const value = structuredClone(exampleDefinition);
      assert.equal(value.execution.kind, "SHOPIFY_STOREFRONT_QUERY");
      if (value.execution.kind !== "SHOPIFY_STOREFRONT_QUERY")
        throw new Error("fixture");
      value.execution.variables = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [
          `v${i}`,
          { literal: multibyte ? "é🙂".repeat(1100) : "x".repeat(6600) },
        ]),
      );
      value.execution.variables.padding = { literal: "" };
      const fixedBytes = Buffer.byteLength(persistedFixtureText(value));
      for (const target of [65535, 65536, 65537]) {
        value.execution.variables.padding = {
          literal: "x".repeat(target - fixedBytes),
        };
        assert.equal(Buffer.byteLength(persistedFixtureText(value)), target);
        assert.equal(definitionStorageBytes(value), target);
        // Compact JSON would wrongly admit the over-boundary case.
        assert(Buffer.byteLength(JSON.stringify(value)) < 65536);
        const result = schema.safeParse(value);
        assert.equal(
          result.success,
          target <= 65536,
          `${strict}/${multibyte}/${target}`,
        );
        if (!result.success)
          assert.deepEqual(
            result.error.issues.map((i) => i.message),
            [DEFINITION_SIZE_MESSAGE],
          );
      }
    }
});
test("R1 aggregate oversized review reproductions reject only for whole-definition size", () => {
  const draft = {
    name: "oversize_tool",
    definitionVersion: "1.0.0",
    description: "Review fixture",
    inputSchema: {},
    execution: { x: "x".repeat(40000) },
    responseTemplate: { x: "x".repeat(40000) },
  };
  const strict = structuredClone(exampleDefinition);
  if (strict.execution.kind !== "SHOPIFY_STOREFRONT_QUERY")
    throw new Error("fixture");
  strict.execution.variables = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `v${i}`,
      { literal: "x".repeat(8000) },
    ]),
  );
  for (const [schema, value] of [
    [CommerceToolDraftDefinitionSchema, draft],
    [CommerceToolDefinitionSchema, strict],
  ] as const) {
    const result = schema.safeParse(value);
    assert.equal(result.success, false);
    if (!result.success)
      assert.deepEqual(
        result.error.issues.map((i) => i.message),
        [DEFINITION_SIZE_MESSAGE],
      );
  }
});
test("R1 storage size includes escaped/multibyte strings and expanded numeric exponents without changing hashes", () => {
  const value = { value: [1e21, 1e-7, -1.25e-7, 1.23e22, 'é🙂\n\t"\\'] };
  const postgresText =
    '{"value": [1000000000000000000000, 0.0000001, -0.000000125, 12300000000000000000000, ' +
    JSON.stringify(value.value[4]) +
    "]}";
  assert.equal(definitionStorageBytes(value), Buffer.byteLength(postgresText));
  assert.equal(canonicalJson({ n: 1e21 }), '{"n":1e+21}');
});
