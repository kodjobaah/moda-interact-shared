import { z } from "zod";

/** Ordered source-backed checkout offers confirmed in one initial outreach send. */
export const InitialOutreachCheckoutOfferSetSchema = z.strictObject({
  schemaVersion: z.literal("moda.outreach.checkout-offers.v1"),
  offers: z.array(z.strictObject({
    offerId: z.string().min(1).max(191),
    providerDiscountId: z.string().min(1).max(191).nullable(),
    method: z.enum(["CODE", "AUTOMATIC"]),
    code: z.string().min(1).max(128).nullable(),
  })).min(1).max(3),
});
export type InitialOutreachCheckoutOfferSet = z.infer<
  typeof InitialOutreachCheckoutOfferSetSchema
>;
