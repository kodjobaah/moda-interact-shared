import { z } from "zod";
import { CommerceProductSchema, CommerceToolInputs } from "../schemas.js";
import { CurrencySchema, DateSchema, HashSchema, IdSchema, MoneySchema } from "../primitives.js";
import { CommerceEnvironmentSchema } from "../model/index.js";
import { InitialOutreachCheckoutOfferSetSchema } from "../outreach-checkout-offer-set.js";
import type { CommerceModelInvoker } from "../runner/types.js";
export const hostId = z.string().trim().min(1).max(191);
const positive = z.number().int().positive().safe();
export const https = z.string().max(2048).url().refine(v => { if (!URL.canParse(v)) return false; const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; });
export const StageSchema = z.enum(['INPUT', 'PRODUCT_READ', 'RECONCILE', 'OFFER_SELECT', 'REVALIDATE', 'COMPLETE']);
export const RefusalReasonSchema = z.enum(['INPUT_INVALID', 'OUTSIDE_CHECKOUT', 'PRODUCT_NOT_FOUND', 'PRODUCT_UNAVAILABLE', 'IDENTITY_MISMATCH', 'CURRENCY_MISMATCH', 'PRICE_UNAVAILABLE', 'ARITHMETIC_UNSAFE', 'PROVIDER_UNAVAILABLE', 'DENIED', 'CANCELLED', 'DEADLINE', 'BUDGET_EXHAUSTED', 'INVALID_RESULT', 'CURRENT_FACTS_CHANGED', 'RESULT_TOO_LARGE']);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;
export const InitialOutreachEvaluationInputSchema = z.strictObject({
    schemaVersion: z.literal(1), runId: hostId, shopId: hostId, platform: z.enum(['SHOPIFY', 'WOOCOMMERCE']), environment: CommerceEnvironmentSchema,
    checkout: z.strictObject({ id: hostId, generation: positive, currency: CurrencySchema, url: https, lines: z.array(z.strictObject({ lineKey: z.string().trim().min(1).max(128), productId: IdSchema, variantId: IdSchema.nullable(), quantity: positive, checkoutUnitPrice: MoneySchema.nullable() })).min(1).max(100) }),
    policy: z.strictObject({ mode: z.enum(['NONE', 'FIXED', 'AI_BEST_APPLICABLE']), authorisedDiscountIds: z.array(IdSchema).max(50) }),
    instructions: z.strictObject({ platformText: z.string().trim().min(1).max(8000), platformRevisionId: hostId, merchantText: z.string().max(8000).nullable(), merchantRevisionId: hostId.nullable(), purposeText: z.string().trim().min(1).max(8000), purposeProfileRevisionId: hostId }),
    limits: z.strictObject({ deadlineMs: positive, modelSteps: positive, remoteCalls: positive, outputTokens: positive }),
}).superRefine((v, c) => {
    const valid = (id: string, kind: string) => v.platform === 'SHOPIFY' ? new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(id) : /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id));
    if (v.checkout.lines.some(l => !valid(l.productId, 'Product') || l.variantId !== null && !valid(l.variantId, 'ProductVariant')))
        c.addIssue({ code: 'custom', message: 'Native product identity invalid' });
    if (new Set(v.checkout.lines.map(l => l.lineKey)).size !== v.checkout.lines.length)
        c.addIssue({ code: 'custom', message: 'Duplicate line key' });
    if (new Set(v.policy.authorisedDiscountIds).size !== v.policy.authorisedDiscountIds.length || v.policy.mode !== 'FIXED' && v.policy.authorisedDiscountIds.length)
        c.addIssue({ code: 'custom', message: 'Invalid discount authorization' });
    if ((v.instructions.merchantText === null) !== (v.instructions.merchantRevisionId === null))
        c.addIssue({ code: 'custom', message: 'Merchant revision pair required' });
});
export const EligibilitySchema = z.strictObject({ offerId: IdSchema, verdict: z.enum(['SUPPORTED', 'NOT_APPLICABLE', 'UNVERIFIABLE']), eligibleLineKeys: z.array(z.string().min(1).max(128)).max(100), reasonCodes: z.array(z.string().min(1).max(96)).max(16) });
export const GroupSchema = z.strictObject({ verdict: z.enum(['SUPPORTED', 'UNVERIFIABLE', 'INCOMPATIBLE']), offerIds: z.array(IdSchema).max(3), reasonCodes: z.array(z.string().min(1).max(96)).max(16) });
export const OfferDecisionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('NO_VERIFIED_OFFER'), reasonCode: z.string().min(1).max(96), discoveryIncomplete: z.boolean() }),
    z.strictObject({ kind: z.literal('CHECKOUT_DISCOUNT'), offerSet: InitialOutreachCheckoutOfferSetSchema, members: z.array(z.strictObject({ offerId: IdSchema, providerDiscountId: IdSchema, method: z.enum(['CODE', 'AUTOMATIC']), code: z.string().max(100).nullable(), description: z.string().min(1).max(200), eligibility: EligibilitySchema })).min(1).max(3), group: GroupSchema, discoveryIncomplete: z.boolean() })
]);
export const ToolActivitySchema = z.strictObject({ toolName: z.string().min(1).max(128), modelStep: z.number().int().nonnegative().safe(), attempt: z.number().int().positive().safe(), status: z.enum(['OK', 'ERROR']), durationMs: z.number().nonnegative().finite(), errorCode: RefusalReasonSchema.nullable() });
export const ReadyEvaluationSchema = z.strictObject({ kind: z.literal('ready'), schemaVersion: z.literal(1), runId: hostId, shopId: hostId, basketFingerprint: HashSchema, evaluatedAt: DateSchema, lines: z.array(z.strictObject({ lineKey: z.string().min(1).max(128), productId: IdSchema, variantId: IdSchema.nullable(), quantity: positive, checkoutUnitPrice: MoneySchema.nullable(), currentProduct: CommerceProductSchema, comparison: z.enum(['EQUAL', 'DIFFERENT', 'INCOMPARABLE']) })).min(1).max(100), currentMerchandiseSubtotal: z.strictObject({ amountDecimal: MoneySchema, currency: CurrencySchema }), offerDecision: OfferDecisionSchema, toolActivity: z.array(ToolActivitySchema).max(10000) });
export const InitialOutreachEvaluationResultSchema = z.discriminatedUnion('kind', [ReadyEvaluationSchema, z.strictObject({ kind: z.literal('refused'), schemaVersion: z.literal(1), runId: hostId, shopId: hostId, stage: StageSchema, reasonCode: RefusalReasonSchema, lineKey: z.string().max(128).nullable(), toolActivity: z.array(ToolActivitySchema).max(10000) })]);
export const CheckoutChoiceSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('NO_VERIFIED_OFFER') }), z.strictObject({ kind: z.literal('CHECKOUT_DISCOUNT'), offerIds: z.array(IdSchema).min(1).max(3).refine(ids => new Set(ids).size === ids.length) })]);
export type InitialOutreachEvaluationInput = z.infer<typeof InitialOutreachEvaluationInputSchema>;
export type InitialOutreachEvaluationResult = z.infer<typeof InitialOutreachEvaluationResultSchema>;
export type ReadyEvaluation = z.infer<typeof ReadyEvaluationSchema>;
export type OfferDecision = z.infer<typeof OfferDecisionSchema>;
export type ToolActivity = z.infer<typeof ToolActivitySchema>;
type CallContext = {
    runId: string;
    shopId: string;
    platform: 'SHOPIFY' | 'WOOCOMMERCE';
    signal: AbortSignal;
};
export type InitialOutreachToolCall = CallContext & ({
    name: 'commerce_get_product';
    arguments: z.infer<typeof CommerceToolInputs.commerce_get_product>;
} | {
    name: 'commerce_get_discount_options';
    arguments: z.infer<typeof CommerceToolInputs.commerce_get_discount_options>;
} | {
    name: 'commerce_get_discount_details';
    arguments: z.infer<typeof CommerceToolInputs.commerce_get_discount_details>;
});
export interface InitialOutreachPorts {
    signal: AbortSignal;
    now(): Date;
    callTool(call: InitialOutreachToolCall): Promise<unknown>;
    modelInvoker: CommerceModelInvoker;
    log(event: {
        stage: z.infer<typeof StageSchema>;
        runId: string;
        shopId: string;
        reasonCode: string | null;
        lineKey: string | null;
        toolName: string | null;
        durationMs: number;
    }): void;
}
