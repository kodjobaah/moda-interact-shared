import { z } from 'zod';
import { ConversationBrandImageOriginSchema, ConversationMediaDeliveryPlanSchema } from './brand-image.js';
import { ConversationProductPairSchema } from './product-image.js';
import { parseRecoveryMultipartDeliveryPlan } from './recovery-multipart.js';
import { stableJson, type PresentationDigest } from './wrapper-projection.js';

/** V1 geometry is immutable. Contain assets; render full authored header once, with no added ornament. */
export const RECOVERY_COMPOSITE_LAYOUT_V1 = Object.freeze({
  width: 1125, headerHeight: 300, productHeight: 600,
  logoLeft: 48, logoTop: 60, logoWidth: 180, logoHeight: 180,
  textLeft: 264, textTop: 24, textWidth: 813, textHeight: 252,
  productLeft: 0, productTop: 300, productWidth: 1125,
} as const);
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const ShopId = ConversationBrandImageOriginSchema.shape.shopId;
const Text = z.string().min(1).max(4096).refine(value => !!value.trim() &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) &&
  Array.from(value).every(character => { const cp = character.codePointAt(0)!; return cp < 0xd800 || cp > 0xdfff; }));
const Header = Text.refine(value => Array.from(value).length <= 512 && value.split('\n').length <= 6);
const SafeHttps = z.string().min(1).max(2048).refine(value => {
  if (/[\x00-\x20\x7f]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash; }
  catch { return false; }
});
const PublicOrigin = SafeHttps.refine(value => { try { return new URL(value).origin === value; } catch { return false; } });
export const RecoveryCompositeLogoSourceSchema = z.strictObject({
  origin: ConversationBrandImageOriginSchema.refine(origin => origin.role === 'LOGO' || origin.role === 'SQUARE_LOGO'),
  contentSha256: Sha256,
});
export const RecoveryCompositeProductSourceSchema = z.strictObject({
  shopId: ShopId, platform: z.enum(['SHOPIFY', 'WOOCOMMERCE']),
  productId: ConversationProductPairSchema.shape.productId,
  variantId: ConversationProductPairSchema.shape.variantId, contentSha256: Sha256,
});
/** Trusted reusable render inputs only: never caption, answer, customer identity or checkout tokens. */
export const RecoveryCompositeProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(1), shopId: ShopId,
  logo: RecoveryCompositeLogoSourceSchema,
  product: RecoveryCompositeProductSourceSchema.nullable(),
  headerText: Header, commonReferenceHash: Sha256,
  layoutVersion: z.literal('RECOVERY_COMPOSITE_V1'), rendererVersion: z.literal('RECOVERY_COMPOSITE_V1'),
  /** SHA-256 of the renderer's canonical ordered font-asset manifest, including shaping configuration. */
  fontAssetSha256: Sha256,
}).superRefine((value, context) => {
  if (value.logo.origin.shopId !== value.shopId || (value.product !== null && value.product.shopId !== value.shopId))
    context.addIssue({ code: 'custom', message: 'COMPOSITE_SHOP_MISMATCH' });
});
export type RecoveryCompositeProvenance = z.infer<typeof RecoveryCompositeProvenanceSchema>;
export const RecoveryPreparedCompositeImageSchema = z.strictObject({
  schemaVersion: z.literal(1), provenance: RecoveryCompositeProvenanceSchema,
  tenantSha256: Sha256, renderIdentitySha256: Sha256,
  publicOrigin: PublicOrigin, publicUrl: SafeHttps, objectKey: z.string().min(1).max(300),
  contentSha256: Sha256, contentType: z.literal('image/jpeg'),
  byteLength: z.number().int().min(1).max(5 * 1024 * 1024 - 1),
  width: z.literal(1125), height: z.union([z.literal(300), z.literal(900)]),
}).superRefine((value, context) => {
  const key = `conversation-composites/v1/${value.tenantSha256}/${value.renderIdentitySha256}/${value.contentSha256}.jpg`;
  if (value.objectKey !== key || value.publicUrl !== `${value.publicOrigin}/${key}` || value.height !== (value.provenance.product === null ? 300 : 900))
    context.addIssue({ code: 'custom', message: 'COMPOSITE_OUTPUT_IDENTITY_INVALID' });
});
export type RecoveryPreparedCompositeImage = z.infer<typeof RecoveryPreparedCompositeImageSchema>;
export const RecoveryCompositeImagePlanSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal('COMPOSITE_IMAGE'),
  /** Actual provider caption: complete authored answer plus the canonical checkout footer. */
  body: Text.refine(value => Array.from(value).length <= 1024),
  /** Complete original canonical header + answer + footer, authoritative for history/moderation. */
  logicalBody: Text, image: RecoveryPreparedCompositeImageSchema,
  boundarySha256: Sha256,
});
export type RecoveryCompositeImagePlan = z.infer<typeof RecoveryCompositeImagePlanSchema>;
/** New reader opt-in; existing carrier validators and their frozen bytes stay unchanged. */
export const ConversationCompositeMediaDeliveryPlanSchema = z.union([ConversationMediaDeliveryPlanSchema, RecoveryCompositeImagePlanSchema]);
export type ConversationCompositeMediaDeliveryPlan = z.infer<typeof ConversationCompositeMediaDeliveryPlanSchema>;
const TrustedContext = z.strictObject({
  provenance: RecoveryCompositeProvenanceSchema, publicOrigin: PublicOrigin,
  answerText: Text, footerText: Text, logicalBody: Text, checkoutUrl: z.string(),
  /** Independently verified renderer/probe receipt, never copied from an untrusted stored plan. */
  output: z.strictObject({contentSha256: Sha256, byteLength: z.number().int().min(1).max(5 * 1024 * 1024 - 1)}),
});
export type RecoveryCompositeTrustedContext = z.infer<typeof TrustedContext>;
function invalid(): never { throw Object.assign(new Error('COMPOSITE_BINDING_INVALID'), { code: 'COMPOSITE_BINDING_INVALID' }); }
function digest(value: string, sha256: PresentationDigest): string { return Sha256.parse(sha256(value)); }
export function digestRecoveryCompositeRenderIdentity(provenance: RecoveryCompositeProvenance, sha256: PresentationDigest): string {
  return digest(stableJson(RecoveryCompositeProvenanceSchema.parse(provenance)), sha256);
}
function boundaries(trusted: RecoveryCompositeTrustedContext, sha256: PresentationDigest) {
  const body = `${trusted.answerText}${trusted.footerText}`;
  if (trusted.logicalBody !== `${trusted.provenance.headerText}${body}`) invalid();
  // Reuse exact trusted checkout validation; do not infer authority from URLs inside authored text.
  parseRecoveryMultipartDeliveryPlan({schemaVersion: 1, kind: 'RECOVERY_MULTIPART', parts: [{role: 'ANSWER', plan: {schemaVersion: 1, kind: 'TEXT', body}}]}, trusted.checkoutUrl);
  return { body, boundarySha256: digest(stableJson({headerText: trusted.provenance.headerText, answerText: trusted.answerText, footerText: trusted.footerText, logicalBody: trusted.logicalBody, body}), sha256) };
}
/** Host supplies original canonical boundaries AND current attested provenance independently of the stored plan.
 * Structural schemas/digests alone are not authorization or proof of current media bytes. */
export function parseRecoveryCompositeImagePlan(raw: unknown, trustedInput: RecoveryCompositeTrustedContext, sha256: PresentationDigest): RecoveryCompositeImagePlan {
  const trusted = TrustedContext.parse(trustedInput), plan = RecoveryCompositeImagePlanSchema.parse(raw);
  const expected = boundaries(trusted, sha256), image = plan.image;
  if (plan.body !== expected.body || plan.logicalBody !== trusted.logicalBody || plan.boundarySha256 !== expected.boundarySha256 ||
      stableJson(image.provenance) !== stableJson(trusted.provenance) || image.publicOrigin !== trusted.publicOrigin ||
      image.tenantSha256 !== digest(trusted.provenance.shopId, sha256) ||
      image.renderIdentitySha256 !== digestRecoveryCompositeRenderIdentity(trusted.provenance, sha256) ||
      image.contentSha256 !== trusted.output.contentSha256 || image.byteLength !== trusted.output.byteLength) invalid();
  return plan;
}
export function buildRecoveryCompositeImagePlan(input: { image: unknown; trusted: RecoveryCompositeTrustedContext }, sha256: PresentationDigest): RecoveryCompositeImagePlan {
  const trusted = TrustedContext.parse(input.trusted), expected = boundaries(trusted, sha256);
  return parseRecoveryCompositeImagePlan({schemaVersion: 1, kind: 'COMPOSITE_IMAGE', ...expected, logicalBody: trusted.logicalBody, image: input.image}, trusted, sha256);
}
/** Binds all caption, logical text, provenance, font/render identity and output bytes metadata; not authorization. */
export function digestRecoveryCompositeImagePlan(plan: RecoveryCompositeImagePlan, sha256: PresentationDigest): string {
  return digest(stableJson(RecoveryCompositeImagePlanSchema.parse(plan)), sha256);
}
