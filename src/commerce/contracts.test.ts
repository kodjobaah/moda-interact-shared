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
  verifyResponseContract,
  EMPTY_RESPONSE_CONTRACT,
} from "./response";
import { canonicalJson, responseContractCanonicalJson } from "./canonical-json";
import {
  CommerceOutreachToolContextSchema,
  type CommerceOutreachToolContext,
} from "./index";
import {
  validateSubset,
  MONEY_PATTERN,
  compileSubset,
  type SubsetSchema,
} from "./subset";
import { exampleDefinition, exampleTool } from "./fixtures";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const ok = (
  s: { safeParse: (v: unknown) => { success: boolean } },
  v: unknown,
) => assert.equal(s.safeParse(v).success, true);
const bad = (
  s: { safeParse: (v: unknown) => { success: boolean } },
  v: unknown,
) => assert.equal(s.safeParse(v).success, false);
test("outreach tool context is strict and contains only its purpose", () => {
  const context = {
    purpose: "INITIAL_RECOVERY_OUTREACH",
  } satisfies CommerceOutreachToolContext;

  ok(CommerceOutreachToolContextSchema, context);
  bad(CommerceOutreachToolContextSchema, { ...context, shopId: "model_forged_shop" });
  bad(CommerceOutreachToolContextSchema, { ...context, checkoutRecoveryId: "recovery_456" });
  bad(CommerceOutreachToolContextSchema, { ...context, outreachAttemptId: "attempt_789" });
  bad(CommerceOutreachToolContextSchema, { ...context, purpose: "CONVERSATION" });
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
