import { z } from "zod";
import { validRange } from "semver";
import {
  ContractVersionSchema as V,
  IdSchema as ID,
  SemverSchema,
  HashSchema,
  DateSchema,
  MoneySchema,
  CurrencySchema,
  distinct,
  boundedJson,
} from "./primitives";
import { GrantedToolsSchema, ToolDescriptorSchema } from "./definitions";
import { CommerceResponseContractSchema } from "./response";
import { canonicalJson, jsonBytes } from "./canonical-json";
export const CommerceTurnIdentitySchema = z.strictObject({
  contractVersion: V,
  shopId: ID,
  checkoutRecoveryId: ID,
  conversationId: ID,
  inboundVersion: z.number().int().positive(),
});
export type CommerceTurnIdentity = z.infer<typeof CommerceTurnIdentitySchema>;
export const CommerceConversationGrantSchema = z
  .strictObject({
    id: ID,
    shopId: ID,
    conversationId: ID,
    initialInboundVersion: z.number().int().positive(),
    releaseId: ID,
    selectedCapabilityKeys: z
      .array(ID)
      .min(1)
      .max(32)
      .refine((v) => distinct(v) && v.includes("conversation_core")),
    grantedTools: GrantedToolsSchema,
    runnerVersion: SemverSchema,
    createdAt: DateSchema,
    expiresAt: DateSchema.nullable(),
  })
  .superRefine((v, c) => {
    if (v.expiresAt && Date.parse(v.expiresAt) <= Date.parse(v.createdAt))
      c.addIssue({ code: "custom", message: "Invalid grant retention date" });
    if (
      jsonBytes(v.grantedTools) > 65536 ||
      jsonBytes(v.selectedCapabilityKeys) > 8192 ||
      v.grantedTools.some((t) =>
        t.capabilityKeys.some((k) => !v.selectedCapabilityKeys.includes(k)),
      )
    )
      c.addIssue({ code: "custom", message: "Unselected grant provenance" });
  });
export type CommerceConversationGrant = z.infer<
  typeof CommerceConversationGrantSchema
>;
export const CommerceConfigurationSchema = z.strictObject({
  maxRecommendations: z.number().int().min(1).max(3).optional(),
  maxSearchResults: z.number().int().min(1).max(20).optional(),
});
export const CommerceManifestSchema = z
  .strictObject({
    contractVersion: V,
    releaseId: ID,
    runnerCompatibility: z
      .string()
      .min(1)
      .max(128)
      .refine((v) => !!validRange(v)),
    capabilities: z
      .array(
        z.strictObject({
          key: ID,
          revisionId: ID,
          position: z.number().int().nonnegative(),
          promptName: z.string().min(1).max(512),
          configuration: CommerceConfigurationSchema,
          toolDescriptors: z.array(ToolDescriptorSchema).max(32),
        }),
      )
      .min(1)
      .max(32),
    selectedCapabilityKeys: z.array(ID).min(1).max(32).refine(distinct),
    grantedTools: GrantedToolsSchema,
    responseContract: CommerceResponseContractSchema,
    responseContractHash: HashSchema,
  })
  .superRefine((v, c) => {
    if (jsonBytes(v) > 262144)
      c.addIssue({ code: "custom", message: "Manifest exceeds output limit" });
    const keys = v.capabilities.map((x) => x.key);
    if (
      !distinct(keys) ||
      !keys.includes("conversation_core") ||
      JSON.stringify(keys) !== JSON.stringify(v.selectedCapabilityKeys) ||
      v.capabilities.some(
        (x, i) => i > 0 && x.position <= v.capabilities[i - 1].position,
      )
    )
      c.addIssue({
        code: "custom",
        message: "Invalid capability ordering/selection",
      });
    const union = new Map<
      string,
      { tool: (typeof v.grantedTools)[number]; descriptor: string }
    >();
    for (const cap of v.capabilities) {
      if (
        cap.promptName !==
        `commerce/${v.releaseId}/${cap.key}/${cap.revisionId}`
      )
        c.addIssue({ code: "custom", message: "Prompt identity mismatch" });
      for (const d of cap.toolDescriptors) {
        const old = union.get(d.toolId);
        const descriptor = canonicalJson(d);
        if (old) {
          if (old.descriptor !== descriptor)
            c.addIssue({
              code: "custom",
              message: "Conflicting tool revisions/descriptors",
            });
          old.tool.capabilityKeys.push(cap.key);
        } else
          union.set(d.toolId, {
            descriptor,
            tool: {
              toolId: d.toolId,
              toolRevisionId: d.toolRevisionId,
              toolName: d.name,
              definitionVersion: d.definitionVersion,
              capabilityKeys: [cap.key],
            },
          });
      }
    }
    if (
      union.size !== v.grantedTools.length ||
      v.grantedTools.some((t) => {
        const expected = union.get(t.toolId)?.tool;
        return (
          !expected ||
          expected.toolRevisionId !== t.toolRevisionId ||
          expected.toolName !== t.toolName ||
          expected.definitionVersion !== t.definitionVersion ||
          JSON.stringify([...new Set(expected.capabilityKeys)].sort()) !==
            JSON.stringify(t.capabilityKeys)
        );
      })
    )
      c.addIssue({
        code: "custom",
        message: "Grant must equal selected binding union",
      });
  });
export type CommerceManifest = z.infer<typeof CommerceManifestSchema>;
export const CommerceReleaseIdentitySchema = z.strictObject({
  contractVersion: V,
  releaseId: ID,
  runnerCompatibility: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => !!validRange(v)),
});
export const CommerceResolveAssertionSchema = CommerceTurnIdentitySchema.extend(
  { purpose: z.literal("resolve") },
);
export const CommerceExecuteAssertionSchema = CommerceTurnIdentitySchema.extend(
  { purpose: z.literal("execute"), grantId: ID, releaseId: ID },
);
export const CommerceAssertionSchema = z.discriminatedUnion("purpose", [
  CommerceResolveAssertionSchema,
  CommerceExecuteAssertionSchema,
]);
const qty = z.number().int().min(1).max(999);
export const CommerceProposalSchema = z
  .strictObject({
    operations: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("ADD"),
            variantId: ID,
            quantity: qty,
          }),
          z.strictObject({
            kind: z.literal("REPLACE"),
            lineId: ID,
            variantId: ID,
            quantity: qty,
          }),
        ]),
      )
      .min(1)
      .max(3),
  })
  .refine((v) =>
    distinct(
      v.operations.flatMap((o) => (o.kind === "REPLACE" ? [o.lineId] : [])),
    ),
  );
export const CommerceBasketSchema = z
  .strictObject({
    basketId: ID,
    source: z.enum(["RECOVERY_SNAPSHOT", "PROPOSED"]),
    observedAt: DateSchema,
    currency: CurrencySchema.nullable(),
    lines: z
      .array(
        z.strictObject({
          lineId: ID,
          productId: ID.nullable(),
          variantId: ID.nullable(),
          quantity: qty.nullable(),
          unitPrice: MoneySchema.nullable(),
        }),
      )
      .max(100),
    fingerprint: HashSchema,
    unknownFields: z.array(z.string().min(1).max(256)).max(128),
  })
  .refine((v) => distinct(v.lines.map((line) => line.lineId)));
export const CommerceProductSchema = z.strictObject({
  productId: ID,
  variantId: ID,
  title: z.string().min(1).max(512),
  url: z
    .url({ protocol: /^https$/ })
    .refine((v) => {
      const u = new URL(v);
      return !u.username && !u.password && !u.port;
    })
    .nullable(),
  available: z.boolean().nullable(),
  unitPrice: MoneySchema.nullable(),
  currency: CurrencySchema.nullable(),
  productType: z.string().max(512).nullable(),
  vendor: z.string().max(512).nullable(),
  observedAt: DateSchema,
});
export const CommerceOfferSchema = z
  .strictObject({
    offerId: ID,
    title: z.string().min(1).max(512),
    method: z.enum(["AUTOMATIC", "CODE"]),
    code: z.string().min(1).max(128).nullable(),
    startsAt: DateSchema.nullable(),
    endsAt: DateSchema.nullable(),
    support: z.enum(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]),
    reasonCodes: z.array(z.string().min(1).max(64)).max(16),
  })
  .refine(
    (v) =>
      (v.startsAt === null ||
        v.endsAt === null ||
        Date.parse(v.startsAt) < Date.parse(v.endsAt)) &&
      (v.method !== "AUTOMATIC" || v.code === null),
  );
const condition = z.strictObject({
  code: z.string().min(1).max(64),
  description: z.string().max(256),
});
export const CommerceEvidenceSchema = z
  .strictObject({
    evidenceId: HashSchema,
    turn: CommerceTurnIdentitySchema,
    grantId: ID,
    releaseId: ID,
    offerId: ID,
    proposal: CommerceProposalSchema.nullable(),
    basketFingerprint: HashSchema,
    ruleFingerprint: HashSchema,
    evaluatedAt: DateSchema,
    expiresAt: DateSchema,
    outcome: z.enum([
      "QUALIFIES_FOR_KNOWN_RULES",
      "DOES_NOT_QUALIFY",
      "UNKNOWN",
      "UNSUPPORTED",
    ]),
    currency: CurrencySchema.nullable(),
    savings: MoneySchema.nullable(),
    resultingTotal: MoneySchema.nullable(),
    evaluatedConditions: z.array(condition).max(32),
    unresolvedConditions: z.array(condition).max(32),
  })
  .superRefine((v, c) => {
    if (Date.parse(v.expiresAt) - Date.parse(v.evaluatedAt) > 60000)
      c.addIssue({
        code: "custom",
        message: "Evidence lifetime exceeds ceiling",
      });
    if (
      v.outcome === "QUALIFIES_FOR_KNOWN_RULES" &&
      (v.unresolvedConditions.length ||
        Date.parse(v.expiresAt) <= Date.parse(v.evaluatedAt) ||
        v.currency === null ||
        v.savings === null ||
        v.resultingTotal === null)
    )
      c.addIssue({ code: "custom", message: "Unsupported qualifying claim" });
  });
export type CommerceEvidence = z.infer<typeof CommerceEvidenceSchema>;
export const CommerceAlternativeSchema = z
  .strictObject({
    product: CommerceProductSchema,
    proposal: CommerceProposalSchema,
    extraSpend: MoneySchema.nullable(),
    resultingTotal: MoneySchema.nullable(),
    currency: CurrencySchema.nullable(),
    evidence: CommerceEvidenceSchema.nullable(),
    similarityReasons: z.array(z.string().max(256)).max(3),
  })
  .refine((v) => v.product.available === true);
export const CommerceErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "DENIED",
  "STALE_TURN",
  "NOT_FOUND",
  "UNAVAILABLE",
  "THROTTLED",
  "DEADLINE",
  "INCOMPATIBLE_VERSION",
]);
export function commerceToolResultSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.strictObject({
      contractVersion: V,
      status: z.literal("OK"),
      data,
      renderedText: z.string().max(4096),
    }),
    z.strictObject({
      contractVersion: V,
      status: z.literal("ERROR"),
      code: CommerceErrorCodeSchema,
      retryable: z.boolean(),
      renderedText: z.string().max(4096).optional(),
    }),
  ]);
}
export const CommerceToolResultSchema = commerceToolResultSchema(
  boundedJson(262144),
);
export type CommerceToolResult = z.infer<typeof CommerceToolResultSchema>;
const limit = z.number().int().min(1).max(3).default(3);
export const CommerceToolInputs = {
  commerce_get_basket: z.strictObject({}),
  commerce_search_products: z.strictObject({
    query: z.string().min(1).max(200),
    maximumPrice: MoneySchema.optional(),
    availableOnly: z.boolean().default(true),
    limit: z.number().int().min(1).max(20).default(10),
    cursor: z.string().max(2048).nullable().default(null),
  }),
  commerce_get_discount_options: z.strictObject({}),
  commerce_evaluate_discount: z.strictObject({
    offerId: ID,
    proposal: CommerceProposalSchema.nullable(),
  }),
  commerce_find_qualifying_products: z.strictObject({
    offerId: ID,
    query: z.string().min(1).max(200).nullable(),
    limit,
  }),
  commerce_find_similar_products: z.strictObject({
    variantId: ID,
    offerId: ID.nullable(),
    limit,
  }),
};
const alternatives = z.strictObject({
  alternatives: z.array(CommerceAlternativeSchema).max(3),
  truncated: z.boolean(),
});
export const CommerceToolOutputs = {
  commerce_get_basket: CommerceBasketSchema,
  commerce_search_products: z.strictObject({
    products: z.array(CommerceProductSchema).max(20),
    cursor: z.string().max(2048).nullable(),
    truncated: z.boolean(),
  }),
  commerce_get_discount_options: z.strictObject({
    mode: z.enum(["NONE", "FIXED", "AI_BEST_APPLICABLE"]),
    offers: z.array(CommerceOfferSchema).max(50),
    truncated: z.boolean(),
  }),
  commerce_evaluate_discount: CommerceEvidenceSchema,
  commerce_find_qualifying_products: alternatives,
  commerce_find_similar_products: alternatives,
};
export function productBelongsToDomain(
  product: z.infer<typeof CommerceProductSchema>,
  verifiedDomain: string,
) {
  try {
    return (
      product.url === null || new URL(product.url).hostname === verifiedDomain
    );
  } catch {
    return false;
  }
}
