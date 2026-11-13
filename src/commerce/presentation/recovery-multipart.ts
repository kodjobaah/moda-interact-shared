import { z } from 'zod';
import { ConversationMediaDeliveryPlanSchema } from './brand-image.js';
import { stableJson, type PresentationDigest } from './wrapper-projection.js';

/** Bounded transport fanout for one logical recovery reply, not extra billing units. */
export const MAX_RECOVERY_DELIVERY_PARTS = 3 as const;
const HeaderPlanSchema = ConversationMediaDeliveryPlanSchema.transform((plan, context) => {
  if (plan.kind === 'TEXT' || (plan.kind === 'BRAND_IMAGE' && ['LOGO', 'SQUARE_LOGO'].includes(plan.image.origin.role))) return plan;
  context.addIssue({ code: 'custom', message: 'RECOVERY_PART_ROLE_INVALID' }); return z.NEVER;
});
const ProductPlanSchema = ConversationMediaDeliveryPlanSchema.transform((plan, context) => {
  if (plan.kind === 'IMAGE') return plan;
  context.addIssue({ code: 'custom', message: 'RECOVERY_PART_ROLE_INVALID' }); return z.NEVER;
});
const AnswerPlanSchema = ConversationMediaDeliveryPlanSchema.transform((plan, context) => {
  if (plan.kind === 'TEXT') return plan;
  context.addIssue({ code: 'custom', message: 'RECOVERY_PART_ROLE_INVALID' }); return z.NEVER;
});
export const RecoveryMultipartDeliveryPartSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('HEADER'), plan: HeaderPlanSchema }),
  z.strictObject({ role: z.literal('PRODUCT'), plan: ProductPlanSchema }),
  z.strictObject({ role: z.literal('ANSWER'), plan: AnswerPlanSchema }),
]).superRefine(({ plan }, context) => {
  if (!plan.body.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(plan.body))
    context.addIssue({ code: 'custom', path: ['plan', 'body'], message: 'RECOVERY_PART_BODY_INVALID' });
});
export type RecoveryMultipartDeliveryPart = z.infer<typeof RecoveryMultipartDeliveryPartSchema>;
const allowedOrders = new Set(['ANSWER', 'HEADER,ANSWER', 'HEADER,PRODUCT', 'HEADER,PRODUCT,ANSWER']);
/** Additive manifest only. The host retains logical text and original authorization receipts. */
export const RecoveryMultipartDeliveryPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('RECOVERY_MULTIPART'),
  parts: z.array(RecoveryMultipartDeliveryPartSchema).min(1).max(MAX_RECOVERY_DELIVERY_PARTS),
}).superRefine((value, context) => {
  if (!allowedOrders.has(value.parts.map(part => part.role).join(',')))
    context.addIssue({ code: 'custom', path: ['parts'], message: 'RECOVERY_PART_ORDER_INVALID' });
  const brand = value.parts.find(part => part.plan.kind === 'BRAND_IMAGE')?.plan;
  const product = value.parts.find(part => part.plan.kind === 'IMAGE')?.plan;
  if (brand?.kind === 'BRAND_IMAGE' && product?.kind === 'IMAGE' && brand.image.origin.shopId !== product.image.shopId)
    context.addIssue({ code: 'custom', path: ['parts'], message: 'RECOVERY_PART_SHOP_MISMATCH' });
});
export type RecoveryMultipartDeliveryPlan = z.infer<typeof RecoveryMultipartDeliveryPlanSchema>;

const CheckoutUrlSchema = z.string().min(1).max(2048).refine(value => {
  if (/[\x00-\x20\x7f]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
}, 'RECOVERY_CHECKOUT_URL_INVALID');
function invalidFooter(): never {
  throw Object.assign(new Error('RECOVERY_CHECKOUT_FOOTER_INVALID'), { code: 'RECOVERY_CHECKOUT_FOOTER_INVALID' });
}
/** The checkout URL is supplied by the trusted recovery host, never inferred from body/model JSON. */
export function parseRecoveryMultipartDeliveryPlan(raw: unknown, checkoutUrl: string): RecoveryMultipartDeliveryPlan {
  const url = CheckoutUrlSchema.parse(checkoutUrl);
  const plan = RecoveryMultipartDeliveryPlanSchema.parse(raw);
  if (plan.parts.some(part => part.plan.body !== url && !part.plan.body.endsWith(`\n${url}`))) invalidFooter();
  return plan;
}
export function buildRecoveryMultipartDeliveryPlan(input: {
  parts: readonly RecoveryMultipartDeliveryPart[]; checkoutUrl: string;
}): RecoveryMultipartDeliveryPlan {
  return parseRecoveryMultipartDeliveryPlan({schemaVersion: 1, kind: 'RECOVERY_MULTIPART', parts: input.parts}, input.checkoutUrl);
}
export function digestRecoveryMultipartDeliveryPlan(plan: RecoveryMultipartDeliveryPlan, sha256: PresentationDigest): string {
  return sha256(stableJson(RecoveryMultipartDeliveryPlanSchema.parse(plan)));
}
