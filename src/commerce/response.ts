import { z } from "zod";
import { IdSchema, LanguageSchema } from "./primitives";
import { DetailsSchemaSchema, compileSubset, type Json } from "./subset";
import {
  jsonBytes,
  responseContractCanonicalJson,
  type Digest,
} from "./canonical-json";
export const CommerceResponseContractSchema = z
  .strictObject({
    version: z.literal("response.v1"),
    instructions: z.string().min(1).max(8000),
    detailsSchema: DetailsSchemaSchema,
  })
  .refine((v) => jsonBytes(v) <= 32768);
export type CommerceResponseContract = z.infer<
  typeof CommerceResponseContractSchema
>;
export const EMPTY_RESPONSE_CONTRACT: CommerceResponseContract = {
  version: "response.v1",
  instructions:
    "Write a concise, natural WhatsApp reply supported by the available facts. Return an empty details object.",
  detailsSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};
export const ReferralReasonSchema = z.enum([
  "INSUFFICIENT_TOOLS",
  "UNVERIFIABLE_FACTS",
  "TOOL_UNAVAILABLE",
  "TOOL_REVOKED",
]);
export const CommerceFinalResponseSchema = z
  .strictObject({
    answerKind: z.enum(["ANSWER", "REFER_TO_STORE"]),
    replyText: z.string().min(1).max(4096),
    referralReason: ReferralReasonSchema.nullable(),
    detectedLanguageTag: LanguageSchema.nullable(),
    detectedLanguageConfidence: z.number().min(0).max(1).nullable(),
    evidenceIds: z
      .array(IdSchema)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
    details: z.record(z.string(), z.unknown()).refine((v) => {
      try {
        return jsonBytes(v) <= 16384;
      } catch {
        return false;
      }
    }),
  })
  .superRefine((v, ctx) => {
    if (
      (v.detectedLanguageTag === null) !==
      (v.detectedLanguageConfidence === null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Language metadata must be a complete pair",
      });
    if (
      v.answerKind === "ANSWER"
        ? v.referralReason !== null
        : v.referralReason === null ||
          v.evidenceIds.length > 0 ||
          Object.keys(v.details).length > 0
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid answer/referral envelope",
      });
  });
export type CommerceFinalResponse = z.infer<typeof CommerceFinalResponseSchema>;
export function finalResponseSchema(definition: CommerceResponseContract) {
  const contract = CommerceResponseContractSchema.parse(definition);
  const details = compileSubset(contract.detailsSchema, "details");
  return CommerceFinalResponseSchema.refine(
    (v) =>
      v.answerKind === "REFER_TO_STORE" || details.safeParse(v.details).success,
    { message: "Details do not match pinned contract" },
  );
}
export function verifyResponseContract(
  definition: unknown,
  hash: string,
  digest: Digest,
) {
  const parsed = CommerceResponseContractSchema.parse(definition);
  if (
    !/^[a-f0-9]{64}$/.test(hash) ||
    digest(responseContractCanonicalJson(parsed)) !== hash
  )
    throw new TypeError("Incompatible response contract");
  return parsed;
}
/** JSON Schema branches retain the immutable envelope; only ANSWER details vary. */
export function finalResponseToolSchema(definition: CommerceResponseContract) {
  const contract = CommerceResponseContractSchema.parse(definition);
  const properties = {
    answerKind: { enum: ["ANSWER", "REFER_TO_STORE"] },
    replyText: { type: "string", minLength: 1, maxLength: 4096 },
    referralReason: {
      enum: [
        null,
        "INSUFFICIENT_TOOLS",
        "UNVERIFIABLE_FACTS",
        "TOOL_UNAVAILABLE",
        "TOOL_REVOKED",
      ],
    },
    detectedLanguageTag: { type: ["string", "null"], maxLength: 128 },
    detectedLanguageConfidence: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1,
    },
    evidenceIds: {
      type: "array",
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", maxLength: 128 },
    },
    details: { type: "object" },
  };
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    allOf: [
      {
        oneOf: [
          {
            properties: {
              answerKind: { const: "ANSWER" },
              referralReason: { type: "null" },
              details: contract.detailsSchema,
            },
          },
          {
            properties: {
              answerKind: { const: "REFER_TO_STORE" },
              referralReason: { enum: ReferralReasonSchema.options },
              evidenceIds: { maxItems: 0 },
              details: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          },
        ],
      },
      {
        oneOf: [
          {
            properties: {
              detectedLanguageTag: { type: "null" },
              detectedLanguageConfidence: { type: "null" },
            },
          },
          {
            properties: {
              detectedLanguageTag: { type: "string" },
              detectedLanguageConfidence: { type: "number" },
            },
          },
        ],
      },
    ],
  } as unknown as Json;
}
