import { z } from "zod";
import { ContractVersionSchema, IdSchema } from "./primitives";

/** Ownership identity, never consent, entitlement or evidence of a checkout. */
export const CommerceConversationScopeSchema = z.enum(["RECOVERY", "STANDALONE"]);
export type CommerceConversationScope = z.infer<typeof CommerceConversationScopeSchema>;
export const CommerceAllowedConversationScopesSchema = z.array(CommerceConversationScopeSchema)
  .min(1).max(2).refine(scopes => new Set(scopes).size === scopes.length);
const common = {
  contractVersion: ContractVersionSchema,
  shopId: IdSchema,
  conversationId: IdSchema,
  inboundVersion: z.number().int().positive(),
};
function identities<T extends z.ZodRawShape>(extra: T) {
  return z.union([
    // Historical recovery bytes and parsed output stay unchanged; no default tag.
    z.strictObject({ ...common, checkoutRecoveryId: IdSchema, ...extra }),
    z.strictObject({ ...common, conversationScope: z.literal("RECOVERY"), checkoutRecoveryId: IdSchema, ...extra }),
    z.strictObject({ ...common, conversationScope: z.literal("STANDALONE"), ...extra }),
  ]);
}
export const CommerceTurnIdentitySchema = identities({});
export type CommerceTurnIdentity = z.infer<typeof CommerceTurnIdentitySchema>;
export const CommerceResolveAssertionSchema = identities({ purpose: z.literal("resolve") });
export const CommerceExecuteAssertionSchema = identities({ purpose: z.literal("execute"), grantId: IdSchema, releaseId: IdSchema });
export const CommerceAssertionSchema = z.union([CommerceResolveAssertionSchema, CommerceExecuteAssertionSchema]);
export function commerceConversationScope(turn: CommerceTurnIdentity): CommerceConversationScope {
  return "conversationScope" in turn ? turn.conversationScope : "RECOVERY";
}
