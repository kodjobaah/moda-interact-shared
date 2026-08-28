import { z } from "zod";

export const CheckoutUpdatedPayloadV2Schema = z
  .object({
    checkoutToken: z.string().min(1),
  })
  .strict();

export type CheckoutUpdatedPayloadV2 = z.infer<
  typeof CheckoutUpdatedPayloadV2Schema
>;
