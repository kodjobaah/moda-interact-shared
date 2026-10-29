import { z } from "zod";
import {
  IdSchema,
  HashSchema,
  DateSchema,
  CurrencySchema,
  MoneySchema,
} from "./commerce/primitives";

export const RecoveryDiscountTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CHECKOUT"),
  }),
  z.strictObject({
    kind: z.literal("ALTERNATIVE_PRODUCT"),
    productId: IdSchema,
    variantId: IdSchema.nullable(),
  }),
]);
export type RecoveryDiscountTarget =
  z.infer<typeof RecoveryDiscountTargetSchema>;

const RecoveryProofIdentityShape = {
  schemaVersion: z.literal(1),
  shopId: IdSchema,
  checkoutRecoveryId: IdSchema,
  outreachAttemptId: IdSchema,
  catalogueDiscountId: IdSchema,
  providerDiscountId: IdSchema,
  checkoutFingerprint: HashSchema,
  target: RecoveryDiscountTargetSchema,
};

export const RecoveryDiscountProofRequestSchema = z.strictObject({
  ...RecoveryProofIdentityShape,
});
export type RecoveryDiscountProofRequest =
  z.infer<typeof RecoveryDiscountProofRequestSchema>;

export const RecoveryEligibleDiscountProofSchema = z.strictObject({
  ...RecoveryProofIdentityShape,
  checkedAt: DateSchema,
  outcome: z.literal("eligible"),
  method: z.enum(["CODE", "AUTOMATIC"]),
  code: z.string().nullable(),
  verifiedDescription: z.string(),
  currency: CurrencySchema.nullable(),
  savings: MoneySchema.nullable(),
  expiresAt: DateSchema,
  verifiedConditions: z.array(z.string()),
});

export const RecoveryNonEligibleDiscountProofSchema = z.strictObject({
  ...RecoveryProofIdentityShape,
  checkedAt: DateSchema,
  outcome: z.enum([
    "ineligible", "unsupported", "unavailable", "stale",
  ]),
  reasonCodes: z.array(z.string()),
});

export const RecoveryDiscountProofResultSchema = z.union([
  RecoveryEligibleDiscountProofSchema,
  RecoveryNonEligibleDiscountProofSchema,
]);
export type RecoveryDiscountProofResult =
  z.infer<typeof RecoveryDiscountProofResultSchema>;
