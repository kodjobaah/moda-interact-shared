import { z } from "zod";
import { MAX_URL_LENGTH } from "../common.schema.js";

export const CheckoutCreatedPayloadV2Schema = z
  .object({
    checkoutToken: z.string().min(1),
    cartToken: z.string().min(1).nullable(),
    abandonedCheckoutUrl: z.url().max(MAX_URL_LENGTH).nullable(),
    checkoutCreatedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type CheckoutCreatedPayloadV2 = z.infer<
  typeof CheckoutCreatedPayloadV2Schema
>;
