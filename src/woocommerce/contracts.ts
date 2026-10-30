import { z } from "zod";

export const WOO_CART_RESTORE_SNAPSHOT_VERSION = "woo.cart-restore.v1" as const;
export const WOO_RESTORE_RESOLVE_VERSION = "woo.restore.resolve.v1" as const;

// Wire IDs remain strings because WordPress/PHP may emit IDs beyond JavaScript's
// safe-integer range. WooCommerce validates their meaning.
const WooPositiveDecimalIdSchema = z.string()
  .min(1).max(20).regex(/^[1-9][0-9]*$/);
const WooOpaqueRecoveryIdSchema = z.string()
  .min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/);
const WooNoControlTextSchema = (max: number) => z.string()
  .min(1).max(max).regex(/^[^\p{Cc}]+$/u);

// This refinement enforces only the structural ten-property limit.
const WooRestoreAttributesV1Schema = z.record(
  WooNoControlTextSchema(80), WooNoControlTextSchema(200),
).superRefine((value, ctx) => {
  if (Object.keys(value).length > 10) {
    ctx.addIssue({ code: "custom", message: "Too many attributes" });
  }
});

const WooAppliedCouponCodesV1Schema = z.array(WooNoControlTextSchema(128)).max(10);

export const WooCartRestoreLineV1Schema = z.strictObject({
  productId: WooPositiveDecimalIdSchema,
  variationId: WooPositiveDecimalIdSchema.optional(),
  quantity: z.number().int().min(1).max(100_000),
  attributes: WooRestoreAttributesV1Schema.optional(),
});
export type WooCartRestoreLineV1 = z.infer<typeof WooCartRestoreLineV1Schema>;

export const WooCartRestoreUnsupportedReasonV1Schema = z.enum([
  "ITEMS_UNAVAILABLE",
  "UNSUPPORTED_PRODUCT_TYPE",
  "CUSTOM_CART_ITEM_DATA",
  "INVALID_VARIATION",
  "COUPONS_UNAVAILABLE",
  "LIMIT_EXCEEDED",
]);
export type WooCartRestoreUnsupportedReasonV1 =
  z.infer<typeof WooCartRestoreUnsupportedReasonV1Schema>;

export const WooCartRestoreSupportedSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(WOO_CART_RESTORE_SNAPSHOT_VERSION),
  kind: z.literal("supported"),
  appliedCouponCodes: WooAppliedCouponCodesV1Schema,
  lines: z.array(WooCartRestoreLineV1Schema).min(1).max(50),
});
export type WooCartRestoreSupportedSnapshotV1 =
  z.infer<typeof WooCartRestoreSupportedSnapshotV1Schema>;

export const WooCartRestoreUnsupportedSnapshotV1Schema = z.strictObject({
  schemaVersion: z.literal(WOO_CART_RESTORE_SNAPSHOT_VERSION),
  kind: z.literal("unsupported"),
  reason: WooCartRestoreUnsupportedReasonV1Schema,
  appliedCouponCodes: WooAppliedCouponCodesV1Schema,
});
export type WooCartRestoreUnsupportedSnapshotV1 =
  z.infer<typeof WooCartRestoreUnsupportedSnapshotV1Schema>;

export const WooCartRestoreSnapshotV1Schema = z.discriminatedUnion("kind", [
  WooCartRestoreSupportedSnapshotV1Schema,
  WooCartRestoreUnsupportedSnapshotV1Schema,
]);
export type WooCartRestoreSnapshotV1 = z.infer<typeof WooCartRestoreSnapshotV1Schema>;

// Extension for API-001's canonical v1 checkout object; not a checkout event
// identity, contact or phone-proof schema.
export const WooCheckoutRestoreExtensionV1Schema = z.strictObject({
  restoration: WooCartRestoreSnapshotV1Schema.optional(),
});
export type WooCheckoutRestoreExtensionV1 =
  z.infer<typeof WooCheckoutRestoreExtensionV1Schema>;

export const WooRestoreResolveRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(WOO_RESTORE_RESOLVE_VERSION),
  recoveryId: WooOpaqueRecoveryIdSchema,
  token: z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/),
});
export type WooRestoreResolveRequestV1 = z.infer<typeof WooRestoreResolveRequestV1Schema>;

// This describes a previously confirmed offer. Eligibility and provenance are
// enforced by API-003, not by this wire-shape schema.
export const WooRestoreOutreachOfferV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("NONE"),
    reason: z.enum(["NO_CONFIRMED_OFFER", "UNVERIFIABLE"]),
  }),
  z.strictObject({
    kind: z.literal("CHECKOUT_CODE"),
    code: WooNoControlTextSchema(128),
    providerDiscountId: WooNoControlTextSchema(191),
  }),
  z.strictObject({
    kind: z.literal("CHECKOUT_AUTOMATIC"),
    providerDiscountId: WooNoControlTextSchema(191),
  }),
  z.strictObject({ kind: z.literal("ALTERNATIVE_PRODUCT") }),
]);
export type WooRestoreOutreachOfferV1 = z.infer<typeof WooRestoreOutreachOfferV1Schema>;

export const WooRestoreResolveResponseV1Schema = z.strictObject({
  schemaVersion: z.literal(WOO_RESTORE_RESOLVE_VERSION),
  status: z.literal("eligible"),
  recoveryId: WooOpaqueRecoveryIdSchema,
  checkoutKey: WooOpaqueRecoveryIdSchema,
  snapshot: WooCartRestoreSupportedSnapshotV1Schema,
  outreachOffer: WooRestoreOutreachOfferV1Schema,
});
export type WooRestoreResolveResponseV1 =
  z.infer<typeof WooRestoreResolveResponseV1Schema>;
