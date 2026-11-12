import { z } from 'zod';
import { HashSchema, DateSchema } from '../primitives.js';
import { ConversationDeliveryPlanSchema, type ConversationDeliveryPlan } from './product-image.js';
import { stableJson, type PresentationDigest } from './wrapper-projection.js';

const Domain = z.string().min(1).max(253).regex(/^[A-Za-z0-9._-]+$/).refine(v => v !== '.' && v !== '..');
const SafeHttps = z.string().min(1).max(2048).refine(value => {
 if (/[\x00-\x20\x7f]/.test(value)) return false;
 try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash; } catch { return false; }
});
const PublicOrigin = SafeHttps.refine(value => { try { return new URL(value).origin === value; } catch { return false; } });
/** Host-attested source identity, not permission to fetch an arbitrary URL. */
export const ConversationBrandImageOriginSchema = z.strictObject({
 kind: z.literal('SHOP_BRAND'), shopId: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
 shopDomain: Domain, role: z.enum(['LOGO', 'SQUARE_LOGO', 'COVER_IMAGE']),
 sourceGeneration: z.number().int().positive().safe(),
 sourceFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type ConversationBrandImageOrigin = z.infer<typeof ConversationBrandImageOriginSchema>;
export const ConversationPreparedBrandImageSchema = z.strictObject({
 schemaVersion: z.literal(1), origin: ConversationBrandImageOriginSchema,
 status: z.literal('READY'), kind: z.literal('R2_DERIVATIVE'),
 publicOrigin: PublicOrigin, publicUrl: SafeHttps, objectKey: z.string().min(1).max(400),
 contentSha256: HashSchema, contentType: z.enum(['image/jpeg', 'image/png']),
 sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024 - 1), width: z.literal(1125), height: z.literal(600), verifiedAt: DateSchema.max(64),
}).superRefine((image, context) => {
 const extension = image.contentType === 'image/jpeg' ? 'jpg' : 'png';
 const expectedKey = `shop-brands/${image.origin.shopDomain}/${image.origin.role.toLowerCase()}/sha256-${image.contentSha256}.${extension}`;
 if (image.objectKey !== expectedKey || image.publicUrl !== `${image.publicOrigin}/${expectedKey}`)
  context.addIssue({ code: 'custom', message: 'BRAND_MEDIA_IDENTITY_INVALID' });
});
export type ConversationPreparedBrandImage = z.infer<typeof ConversationPreparedBrandImageSchema>;
const Body = z.string().min(1).max(4096).refine(v => !!v.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v));
export const ConversationBrandImageDeliveryPlanSchema = z.strictObject({
 schemaVersion: z.literal(1), kind: z.literal('BRAND_IMAGE'), body: Body, image: ConversationPreparedBrandImageSchema,
}).superRefine((plan, context) => {
 if (Array.from(plan.body).length > 1024) context.addIssue({ code: 'custom', path: ['body'], message: 'CAPTION_TOO_LONG' });
});
export type ConversationBrandImageDeliveryPlan = z.infer<typeof ConversationBrandImageDeliveryPlanSchema>;
/** Additive carrier. The legacy product IMAGE validator remains deliberately unchanged. */
export const ConversationMediaDeliveryPlanSchema = z.union([ConversationDeliveryPlanSchema, ConversationBrandImageDeliveryPlanSchema]);
export type ConversationMediaDeliveryPlan = z.infer<typeof ConversationMediaDeliveryPlanSchema>;
export type ConversationBrandMediaOmission = 'PRODUCT_IMAGE_PRIORITY' | 'CAPTION_TOO_LONG' | 'IMAGE_UNAVAILABLE' | 'IMAGE_IDENTITY_MISMATCH';
/** Caller must separately attest current same-tenant READY state and authorization before sending. */
export function buildConversationBrandImageDeliveryPlan(input: {
 plan: ConversationDeliveryPlan; origin: ConversationBrandImageOrigin; publicOrigin: string; image?: ConversationPreparedBrandImage | null;
}): { plan: ConversationMediaDeliveryPlan; mediaOmission: ConversationBrandMediaOmission | null } {
 const plan = ConversationDeliveryPlanSchema.parse(input.plan);
 if (plan.kind === 'IMAGE') return { plan, mediaOmission: 'PRODUCT_IMAGE_PRIORITY' };
 Body.parse(plan.body);
 const fallback = (mediaOmission: ConversationBrandMediaOmission) => ({ plan, mediaOmission });
 if (Array.from(plan.body).length > 1024) return fallback('CAPTION_TOO_LONG');
 if (input.image == null) return fallback('IMAGE_UNAVAILABLE');
 const origin = ConversationBrandImageOriginSchema.safeParse(input.origin);
 const publicOrigin = PublicOrigin.safeParse(input.publicOrigin);
 const image = ConversationPreparedBrandImageSchema.safeParse(input.image);
 if (!origin.success || !publicOrigin.success || !image.success || stableJson(origin.data) !== stableJson(image.data.origin) || publicOrigin.data !== image.data.publicOrigin)
  return fallback('IMAGE_IDENTITY_MISMATCH');
 return { plan: ConversationBrandImageDeliveryPlanSchema.parse({ schemaVersion: 1, kind: 'BRAND_IMAGE', body: plan.body, image: image.data }), mediaOmission: null };
}
export function digestConversationMediaDeliveryPlan(plan: ConversationMediaDeliveryPlan, sha256: PresentationDigest): string {
 return sha256(stableJson(ConversationMediaDeliveryPlanSchema.parse(plan)));
}
