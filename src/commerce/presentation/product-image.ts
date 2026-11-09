import { z } from 'zod';
import { CommerceProductSchema } from '../schemas.js';
import { stableJson, type PresentationDigest } from './wrapper-projection.js';
const BoundId = z.string().min(1).max(256);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const HttpsUrl = z.string().max(2048).url().refine(v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } });
const Platform = z.enum(['SHOPIFY', 'WOOCOMMERCE']);
export const ConversationProductImageBindingSchema = z.strictObject({ variable: z.literal('response.productImage'), placement: z.literal('BEFORE_BODY'), optional: z.literal(true) });
export type ConversationProductImageBinding = z.infer<typeof ConversationProductImageBindingSchema>;
export const ConversationProductPairSchema = z.strictObject({ productId: CommerceProductSchema.shape.productId, variantId: CommerceProductSchema.shape.variantId });
export type ConversationProductPair = z.infer<typeof ConversationProductPairSchema>;
const key = (pair: ConversationProductPair) => stableJson({ productId: pair.productId, variantId: pair.variantId });
const Pairs = z.array(ConversationProductPairSchema).max(3).refine(p => new Set(p.map(key)).size === p.length);
export const ConversationVerifiedProductsSchema = z.strictObject({ shopId: BoundId, platform: Platform, products: z.array(CommerceProductSchema).max(3) });
export type ConversationVerifiedProducts = z.infer<typeof ConversationVerifiedProductsSchema>;
export const ConversationProductImageSourceSchema = z.strictObject({ kind: z.literal('SOURCE'), shopId: BoundId, platform: Platform, productId: CommerceProductSchema.shape.productId, variantId: CommerceProductSchema.shape.variantId, sourceUrl: HttpsUrl });
export type ConversationProductImageSource = z.infer<typeof ConversationProductImageSourceSchema>;
export const ConversationPreparedProductImageSchema = z.strictObject({
 schemaVersion: z.literal(1), shopId: BoundId, productId: CommerceProductSchema.shape.productId, variantId: CommerceProductSchema.shape.variantId,
 publicUrl: HttpsUrl, objectKey: z.string().max(300).regex(/^conversation-products\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.jpg$/),
 contentSha256: Sha256, contentType: z.literal('image/jpeg'), byteLength: z.number().int().min(1).max(5 * 1024 * 1024 - 1), width: z.literal(1125), height: z.literal(600),
});
export type ConversationPreparedProductImage = z.infer<typeof ConversationPreparedProductImageSchema>;
const Body = z.string().min(1).max(4096);
export const ConversationDeliveryPlanSchema = z.discriminatedUnion('kind', [
 z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('TEXT'), body: Body }),
 z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('IMAGE'), body: Body, image: ConversationPreparedProductImageSchema }),
]).superRefine((v, ctx) => { if (v.kind === 'IMAGE' && Array.from(v.body).length > 1024) ctx.addIssue({ code: 'custom', path: ['body'], message: 'CAPTION_TOO_LONG' }); });
export type ConversationDeliveryPlan = z.infer<typeof ConversationDeliveryPlanSchema>;
function failure(code: string): never { throw Object.assign(new Error(code), { code }); }
export function chooseConversationProductImageSource(input: { shopId: string; platform: z.infer<typeof Platform>; displayedPairs: readonly ConversationProductPair[]; verifiedProducts: ConversationVerifiedProducts }): ConversationProductImageSource | { kind: 'OMITTED'; reason: 'NO_PRESENTED_PRODUCT' | 'NO_PRODUCT_IMAGE' | 'PRODUCT_NOT_VERIFIED' } {
 // Check envelope identity before inspecting any product field, including image URLs.
 if (!input || !input.verifiedProducts || input.shopId !== input.verifiedProducts.shopId || input.platform !== input.verifiedProducts.platform) return failure('PRODUCT_IMAGE_IDENTITY_INVALID');
 const parsed = z.strictObject({ shopId: BoundId, platform: Platform, displayedPairs: Pairs, verifiedProducts: ConversationVerifiedProductsSchema }).safeParse(input);
 if (!parsed.success) return failure('PRODUCT_IMAGE_IDENTITY_INVALID');
 const { shopId, platform, displayedPairs, verifiedProducts } = parsed.data;
 if (shopId !== verifiedProducts.shopId || platform !== verifiedProducts.platform || new Set(verifiedProducts.products.map(key)).size !== verifiedProducts.products.length) return failure('PRODUCT_IMAGE_IDENTITY_INVALID');
 const first = displayedPairs[0];
 if (!first) return { kind: 'OMITTED', reason: 'NO_PRESENTED_PRODUCT' };
 const product = verifiedProducts.products.find(p => key(p) === key(first));
 if (!product) return { kind: 'OMITTED', reason: 'PRODUCT_NOT_VERIFIED' };
 const image = HttpsUrl.safeParse(product.imageUrl);
 if (!image.success) return { kind: 'OMITTED', reason: 'NO_PRODUCT_IMAGE' };
 return ConversationProductImageSourceSchema.parse({ kind: 'SOURCE', shopId, platform, ...first, sourceUrl: image.data });
}
export type ConversationMediaOmission = 'BINDING_DISABLED' | 'NO_PRESENTED_PRODUCT' | 'CAPTION_TOO_LONG' | 'IMAGE_UNAVAILABLE' | 'IMAGE_IDENTITY_MISMATCH';
export function buildConversationDeliveryPlan(input: { body: string; binding?: ConversationProductImageBinding; image?: ConversationPreparedProductImage | null; shopId: string; displayedPairs: readonly ConversationProductPair[] }): { plan: ConversationDeliveryPlan; mediaOmission: ConversationMediaOmission | null } {
 const body = Body.parse(input.body);
 if (!body.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)) return failure('INVALID_INPUT');
 if (input.binding !== undefined && !ConversationProductImageBindingSchema.safeParse(input.binding).success) return failure('PREPARED_INVALID');
 const text = (mediaOmission: ConversationMediaOmission) => ({ plan: ConversationDeliveryPlanSchema.parse({ schemaVersion: 1, kind: 'TEXT', body }), mediaOmission });
 if (input.binding === undefined) return text('BINDING_DISABLED');
 const pairs = Pairs.safeParse(input.displayedPairs);
 if (!pairs.success || !BoundId.safeParse(input.shopId).success) return failure('PRODUCT_IMAGE_IDENTITY_INVALID');
 if (!pairs.data.length) return text('NO_PRESENTED_PRODUCT');
 if (Array.from(body).length > 1024) return text('CAPTION_TOO_LONG');
 if (input.image == null) return text('IMAGE_UNAVAILABLE');
 const image = ConversationPreparedProductImageSchema.safeParse(input.image);
 if (!image.success || image.data.shopId !== input.shopId || key(image.data) !== key(pairs.data[0]!)) return text('IMAGE_IDENTITY_MISMATCH');
 return { plan: ConversationDeliveryPlanSchema.parse({ schemaVersion: 1, kind: 'IMAGE', body, image: image.data }), mediaOmission: null };
}
export function digestConversationDeliveryPlan(plan: ConversationDeliveryPlan, sha256: PresentationDigest): string {
 return sha256(stableJson(ConversationDeliveryPlanSchema.parse(plan)));
}
