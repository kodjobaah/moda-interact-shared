import { z } from 'zod';
import { hostId, https, ReadyEvaluationSchema } from './contracts.js';
import { HashSchema, DateSchema } from '../primitives.js';
const text = z.string().min(1).max(512);
export const SemanticKeySchema = z.enum(['customer.firstName', 'shop.name', 'shop.categoryName', 'checkout.url', 'checkout.itemsSummary', 'offer.code', 'offer.codes', 'offer.description', 'promotion.productName', 'promotion.productUrl', 'promotion.offerDescription', 'promotion.code', 'shopBrand.brandName', 'shopBrand.logoAltText', 'shopBrand.logoWidth', 'shopBrand.logoHeight', 'shopBrand.squareLogoAltText', 'shopBrand.logoUrl', 'shopBrand.squareLogoUrl', 'shopBrand.coverImageUrl']);
const slots = z.array(z.strictObject({ position: z.number().int().positive(), variable: SemanticKeySchema }));
export const FrozenBindingsSchema = z.strictObject({ schemaVersion: z.literal(1).optional(), promotionTarget: z.enum(['CHECKOUT', 'ALTERNATIVE_PRODUCT']).optional(), headerMediaRole: z.enum(['LOGO', 'SQUARE_LOGO', 'COVER_IMAGE', 'CHECKOUT_PRODUCT']).optional(), header: slots.max(1).optional(), body: slots.max(10), buttons: z.array(z.strictObject({ index: z.number().int().min(0).max(1), subType: z.literal('url'), variable: z.enum(['checkout.url', 'promotion.productUrl']) })).max(2) });
export const ComponentSchema = z.union([
    z.strictObject({ type: z.literal('HEADER'), format: z.literal('TEXT'), text: z.string().min(1).max(60), example: z.strictObject({ header_text: z.array(z.string().max(200)).max(1) }).optional() }),
    z.strictObject({ type: z.literal('HEADER'), format: z.literal('IMAGE'), example: z.strictObject({ header_handle: z.array(z.string().max(2048)).max(1) }).optional() }),
    z.strictObject({ type: z.literal('BODY'), text: z.string().min(1).max(1024), example: z.strictObject({ body_text: z.array(z.array(z.string().max(4096)).max(10)).max(1) }).optional() }),
    z.strictObject({ type: z.literal('FOOTER'), text: z.string().min(1).max(60) }),
    z.strictObject({ type: z.literal('BUTTONS'), buttons: z.array(z.strictObject({ type: z.literal('URL'), text: z.string().min(1).max(25), url: z.string().min(1).max(2048), example: z.array(z.string().max(2048)).max(1).optional() })).max(2) })
]);
export const RegistrationSchema = z.strictObject({ id: hostId, wabaId: hostId, providerTemplateName: text, providerLanguageCode: text, providerTemplateId: hostId.nullable(), category: text, providerStatus: text.nullable(), submissionState: text, failureCode: text.nullable(), lastObservedContentHash: HashSchema.nullable(), lastObservedCategory: text.nullable(), driftDetectedAt: DateSchema.nullable(), submittedContentHash: HashSchema, componentsSnapshot: z.array(ComponentSchema).min(1).max(4), parameterBindingsSnapshot: FrozenBindingsSchema, locale: z.strictObject({ id: hostId, languageTag: text, providerLanguageCode: text.nullable(), status: text, contentHash: HashSchema.nullable(), definition: z.strictObject({ id: hostId, kind: text, purpose: text.nullable(), offerType: text.nullable(), status: text, category: text.nullable(), providerTemplateName: text.nullable(), publishedAt: DateSchema.nullable(), retiredAt: DateSchema.nullable() }) }) });
export const AssignedVariantSchema = z.strictObject({ id: hostId, shopId: hostId, providerAccountId: hostId, purpose: text, languageTag: text, providerLanguageCode: text, providerTemplateName: text, providerTemplateId: hostId.nullable(), status: text, enabled: z.boolean(), metaRegistrationId: hostId.nullable(), metaRegistration: RegistrationSchema.nullable() });
const ProjectionSchema = z.strictObject({ variant: AssignedVariantSchema, canonicalLanguageTag: text, selectionSource: z.enum(['exact', 'base', 'merchant-fallback', 'platform-fallback']) });
export const PreparedProjectionSchema = ProjectionSchema.extend({ textFallback: ProjectionSchema.nullable().optional() });
export const ReadyMediaSchema = z.strictObject({ shopId: hostId, role: z.enum(['LOGO', 'SQUARE_LOGO', 'COVER_IMAGE', 'CHECKOUT_PRODUCT']), status: z.literal('READY'), kind: z.literal('R2_DERIVATIVE'), httpsUrl: https });
export const InitialOutreachRenderInputSchema = z.strictObject({ schemaVersion: z.literal(1), evaluation: ReadyEvaluationSchema, preparedProjection: PreparedProjectionSchema.nullable(), variables: z.strictObject({ shopName: z.string().max(200).nullable(), customerFirstName: z.string().max(200).nullable(), checkoutUrl: https, shopCategory: z.string().max(200).nullable() }), headerMedia: ReadyMediaSchema.nullable() });
export const RenderReasonSchema = z.enum(['INVALID_REQUEST', 'INVALID_LANGUAGE', 'SHOP_UNAVAILABLE', 'SENDER_UNAVAILABLE', 'SENDER_MISMATCH', 'NO_LANGUAGE', 'NO_APPROVED_ASSIGNMENT', 'LEGACY_ASSIGNMENT', 'AMBIGUOUS_ASSIGNMENT', 'REGISTRATION_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_DRIFT', 'IDENTITY_MISMATCH', 'DEFINITION_UNAVAILABLE', 'LOCALE_UNAVAILABLE', 'BINDINGS_INVALID', 'BINDING_FINGERPRINT_MISMATCH', 'BINDING_VALUE_UNAVAILABLE', 'CHECKOUT_UNAVAILABLE', 'CHECKOUT_UNTRUSTED', 'MEDIA_NOT_READY', 'PROMOTION_PRODUCT_URL_UNAVAILABLE', 'MESSAGE_TOO_LARGE']);
const TextParameterSchema = z.strictObject({ type: z.literal('text'), text: z.string().max(4096) });
export const PreparedComponentSchema = z.union([
    z.strictObject({ type: z.literal('header'), parameters: z.array(z.union([TextParameterSchema, z.strictObject({ type: z.literal('image'), image: z.strictObject({ link: https }) })])).max(1) }),
    z.strictObject({ type: z.literal('body'), parameters: z.array(TextParameterSchema).max(10) }),
    z.strictObject({ type: z.literal('button'), sub_type: z.literal('url'), index: z.string().regex(/^[01]$/), parameters: z.tuple([TextParameterSchema]) })
]);
export const InitialOutreachRenderResultSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ready'), purpose: z.enum(['INITIAL_NO_OFFER', 'INITIAL_CODE_OFFER', 'INITIAL_AUTOMATIC_OFFER']), templateProvenance: z.strictObject({ variantId: hostId, registrationId: hostId, definitionId: hostId, providerTemplateId: hostId, providerTemplateName: text, providerLanguageCode: text, submittedContentHash: HashSchema, bindingFingerprint: HashSchema }), parameters: z.array(PreparedComponentSchema).max(4), headerPreview: ReadyMediaSchema.nullable(), renderedText: z.string().max(8192) }),
    z.strictObject({ kind: z.literal('refused'), reasonCode: RenderReasonSchema })
]);
export type InitialOutreachRenderInput = z.infer<typeof InitialOutreachRenderInputSchema>;
export type InitialOutreachRenderResult = z.infer<typeof InitialOutreachRenderResultSchema>;
