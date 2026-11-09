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
      properties: { x: { type: ["string", "number"], maxLength: 3 } },
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
import { EMPTY_RESPONSE_CONTRACT, finalResponseToolSchema, finalResponseSchema } from './response';
import { PLATFORM_INSTRUCTIONS } from './runner/instructions';
import { exampleFinal } from './fixtures';
test('provider-facing final tool exposes pinned selections without making them mandatory for referrals',()=>{
 const detailsSchema={type:'object',properties:{productRecommendations:{type:'array',maxItems:3,items:{type:'string',maxLength:128}}},required:[],additionalProperties:false} as const;
 const contract={...EMPTY_RESPONSE_CONTRACT,detailsSchema:structuredClone(detailsSchema)};
 const schema=finalResponseToolSchema(contract as unknown as typeof EMPTY_RESPONSE_CONTRACT) as any;
 assert.deepEqual(schema.properties.details.properties,detailsSchema.properties);
 assert.deepEqual(schema.allOf[0].oneOf[0].properties.details,detailsSchema);
 assert.equal(finalResponseSchema(contract as unknown as typeof EMPTY_RESPONSE_CONTRACT).safeParse({...exampleFinal,answerKind:'REFER_TO_STORE',referralReason:'UNVERIFIABLE_FACTS',evidenceIds:[],details:{}}).success,true);
 assert.ok(PLATFORM_INSTRUCTIONS.some(text=>text.includes('Do not supply only replyText or empty details')));
});
