import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSubset,
  InputSchemaSchema,
  type SubsetSchema,
  validateSubset,
} from "./subset";

const bad = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  assert.equal(schema.safeParse(value).success, false);

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