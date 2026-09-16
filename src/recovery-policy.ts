import { z } from "zod";

export const RECOVERY_OFFER_MODES = [
  "NONE",
  "FIXED",
  "AI_BEST_APPLICABLE",
] as const;

export const RecoveryOfferModeSchema = z.enum(RECOVERY_OFFER_MODES);
export type RecoveryOfferMode = z.infer<typeof RecoveryOfferModeSchema>;

export const EffectiveRecoveryPolicySchema = z
  .object({
    recoveryDelayMinutes: z.number().int().min(0).max(10080),
    recoveryOfferMode: RecoveryOfferModeSchema,
    fixedShopifyDiscountId: z.string().trim().nullable(),
    followUpEnabled: z.boolean(),
    followUpDelayMinutes: z.number().int().min(1).max(10080).nullable(),
    source: z.enum(["MERCHANT", "ADMIN_OVERRIDE"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.recoveryOfferMode === "FIXED") {
      if (value.fixedShopifyDiscountId === null || value.fixedShopifyDiscountId.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["fixedShopifyDiscountId"],
          message: "fixedShopifyDiscountId is required when recoveryOfferMode is FIXED",
        });
      }
    } else if (value.fixedShopifyDiscountId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["fixedShopifyDiscountId"],
        message: "fixedShopifyDiscountId must be null when recoveryOfferMode is not FIXED",
      });
    }

    if (value.followUpEnabled) {
      if (value.followUpDelayMinutes === null) {
        ctx.addIssue({
          code: "custom",
          path: ["followUpDelayMinutes"],
          message: "followUpDelayMinutes is required when followUpEnabled is true",
        });
      }
    } else if (value.followUpDelayMinutes !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["followUpDelayMinutes"],
        message: "followUpDelayMinutes must be null when followUpEnabled is false",
      });
    }
  });

export type EffectiveRecoveryPolicy = z.infer<typeof EffectiveRecoveryPolicySchema>;

export function parseEffectiveRecoveryPolicy(input: unknown): EffectiveRecoveryPolicy {
  return EffectiveRecoveryPolicySchema.parse(input);
}

export function safeParseEffectiveRecoveryPolicy(input: unknown) {
  return EffectiveRecoveryPolicySchema.safeParse(input);
}
