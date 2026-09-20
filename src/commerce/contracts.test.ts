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
  CommerceTurnIdentitySchema,
  CommerceAssertionSchema,
  CommerceToolInputs,
  CommerceToolOutputs,
  CommerceEvidenceSchema,
  CommerceFinalResponseSchema,
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
test("R01/R02/R03/R08: configurable required details, strict envelopes and empty referrals", () => {
  ok(finalResponseSchema(EMPTY_RESPONSE_CONTRACT), exampleFinal);
  const definition = {
    ...EMPTY_RESPONSE_CONTRACT,
    detailsSchema: {
      type: "object",
      properties: { newFact: { type: "string", maxLength: 100 } },
      required: ["newFact"],
      additionalProperties: false,
    } as SubsetSchema,
  };
  const answer = {
    ...exampleFinal,
    answerKind: "ANSWER",
    referralReason: null,
    details: { newFact: "Verified fixture" },
  };
  ok(finalResponseSchema(definition), answer);
  ok(finalResponseSchema(definition), exampleFinal);
  for (const details of [{}, { newFact: 3 }, { newFact: "yes", extra: 1 }])
    bad(finalResponseSchema(definition), { ...answer, details });
  bad(CommerceFinalResponseSchema, { ...exampleFinal, referralReason: null });
  bad(CommerceFinalResponseSchema, {
    ...exampleFinal,
    evidenceIds: ["fabricated"],
  });
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
test("dynamic feature selection preserves plan/opt-in policy and offers without paid gating", () => {
  const base = {
    binding: { kind: "BASE" as const, key: "conversation_core" as const },
    enabled: true,
    position: 0,
  };
  const fresh = {
    binding: {
      kind: "FEATURE" as const,
      key: "never_created_before",
      featureId: "new-feature",
    },
    enabled: true,
    position: 1,
  };
  const discount = {
    binding: {
      kind: "RECOVERY_POLICY" as const,
      key: "discount_assistance" as const,
    },
    enabled: true,
    position: 2,
  };
  for (const offerMode of ["NONE", "FIXED", "AI_BEST_APPLICABLE"] as const) {
    const selected = selectCapabilities([discount, fresh, base], {
      features: [
        {
          id: "new-feature",
          active: true,
          planMappingEnabled: true,
          mode: "MERCHANT_OPT_IN",
          preferenceEnabled: true,
        },
      ],
      offerMode,
    });
    assert.deepEqual(
      selected,
      offerMode === "NONE"
        ? ["conversation_core", "never_created_before"]
        : ["conversation_core", "never_created_before", "discount_assistance"],
    );
  }
  assert.deepEqual(
    selectCapabilities([base, fresh], {
      features: [
        {
          id: "new-feature",
          active: true,
          planMappingEnabled: false,
          mode: "ALWAYS_ENABLED",
          preferenceEnabled: true,
        },
      ],
      offerMode: null,
    }),
    ["conversation_core"],
  );
  assert.deepEqual(
    selectCapabilities([base, fresh], {
      features: [
        {
          id: "new-feature",
          active: true,
          planMappingEnabled: true,
          mode: "MERCHANT_OPT_IN",
          preferenceEnabled: null,
        },
      ],
      offerMode: null,
    }),
    ["conversation_core"],
  );
  assert.throws(() =>
    selectCapabilities([{ ...base, enabled: false }], {
      features: [],
      offerMode: null,
    }),
  );
});
test("shared revision deduplicates provenance and conflicting associations reject; grants never widen", () => {
  const tools = deduplicateTools([
    { key: "z_feature", toolDescriptors: [exampleTool] },
    { key: "a_feature", toolDescriptors: [exampleTool] },
  ]);
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].capabilityKeys, ["a_feature", "z_feature"]);
  assert.throws(() =>
    deduplicateTools([
      { key: "a", toolDescriptors: [exampleTool] },
      {
        key: "b",
        toolDescriptors: [{ ...exampleTool, toolRevisionId: "different" }],
      },
    ]),
  );
  const m = exampleManifest(digest, true);
  ok(CommerceManifestSchema, m);
  const g = exampleGrant(m);
  assert.equal(
    currentlyGrantedTools(
      g,
      new Set(["new_feature"]),
      new Set([exampleTool.toolId]),
    ).length,
    0,
  );
  assert.equal(
    currentlyGrantedTools(
      g,
      new Set(["conversation_core"]),
      new Set([exampleTool.toolId]),
    ).length,
    1,
  );
  bad(CommerceManifestSchema, { ...m, grantedTools: [] });
  bad(CommerceManifestSchema, { ...m, selectedCapabilityKeys: ["other"] });
});
test("strict identity/assertion/language contracts retain null-pair and no standalone contexts", () => {
  ok(CommerceTurnIdentitySchema, exampleTurn);
  for (const checkoutRecoveryId of [
    "standalone",
    "product-only",
    "unknown-shop",
    "",
  ])
    bad(CommerceTurnIdentitySchema, { ...exampleTurn, checkoutRecoveryId });
  bad(CommerceTurnIdentitySchema, {
    ...exampleTurn,
    contractVersion: "commerce.v2",
  });
  ok(CommerceAssertionSchema, { ...exampleTurn, purpose: "resolve" });
  bad(CommerceAssertionSchema, {
    ...exampleTurn,
    purpose: "resolve",
    releaseId: "not-yet",
  });
  bad(CommerceAssertionSchema, {
    ...exampleTurn,
    purpose: "execute",
    releaseId: "release",
  });
  bad(CommerceFinalResponseSchema, {
    ...exampleFinal,
    detectedLanguageTag: "fr",
  });
  bad(CommerceFinalResponseSchema, {
    ...exampleFinal,
    detectedLanguageTag: "not_a_tag",
    detectedLanguageConfidence: 0.9,
  });
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
      { products: [], cursor: null, truncated: false },
    ],
    commerce_get_discount_options: [
      {},
      { mode: "NONE", offers: [], truncated: false },
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
