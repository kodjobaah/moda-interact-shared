import { z } from "zod";

export const RecoveryTemplateSemanticKeySchema = z.enum([
  "customer.firstName",
  "shop.name",
  "shop.categoryName",
  "checkout.url",
  "checkout.itemsSummary",
  "offer.code",
  "offer.codes",
  "offer.description",
  "promotion.productName",
  "promotion.productUrl",
  "promotion.offerDescription",
  "promotion.code",
  "shopBrand.brandName",
  "shopBrand.logoUrl",
  "shopBrand.logoAltText",
  "shopBrand.logoWidth",
  "shopBrand.logoHeight",
  "shopBrand.squareLogoUrl",
  "shopBrand.squareLogoAltText",
  "shopBrand.coverImageUrl",
]);
export type RecoveryTemplateSemanticKey =
  z.infer<typeof RecoveryTemplateSemanticKeySchema>;

export const RecoveryPromotionTargetSchema = z.enum([
  "CHECKOUT",
  "ALTERNATIVE_PRODUCT",
]);
export type RecoveryPromotionTarget =
  z.infer<typeof RecoveryPromotionTargetSchema>;

export const RecoveryTemplateHeaderMediaRoleSchema = z.enum([
  "LOGO",
  "SQUARE_LOGO",
  "COVER_IMAGE",
  "CHECKOUT_PRODUCT",
]);
export type RecoveryTemplateHeaderMediaRole =
  z.infer<typeof RecoveryTemplateHeaderMediaRoleSchema>;

export const RecoveryTemplateTextBindingSchema = z.strictObject({
  position: z.number().int(),
  variable: RecoveryTemplateSemanticKeySchema,
});
export type RecoveryTemplateTextBinding =
  z.infer<typeof RecoveryTemplateTextBindingSchema>;

export const RecoveryTemplateUrlButtonBindingSchema = z.strictObject({
  index: z.number().int(),
  subType: z.literal("url"),
  variable: z.enum([
    "checkout.url",
    "promotion.productUrl",
  ]),
});
export type RecoveryTemplateUrlButtonBinding =
  z.infer<typeof RecoveryTemplateUrlButtonBindingSchema>;

export const RecoveryTemplateFrozenBindingsSchema = z.strictObject({
  schemaVersion: z.literal(1).optional(),
  promotionTarget: RecoveryPromotionTargetSchema.optional(),
  headerMediaRole: RecoveryTemplateHeaderMediaRoleSchema.optional(),
  header: z.array(RecoveryTemplateTextBindingSchema).optional(),
  body: z.array(RecoveryTemplateTextBindingSchema),
  buttons: z.array(RecoveryTemplateUrlButtonBindingSchema),
});
export type RecoveryTemplateFrozenBindings =
  z.infer<typeof RecoveryTemplateFrozenBindingsSchema>;
