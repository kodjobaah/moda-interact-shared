import { z } from "zod";
import { MAX_URL_LENGTH } from "../common.schema.js";

const MAX_CART_TOKEN_LENGTH = 100;

export const CheckoutUpdatedPayloadV3Schema = z
  .object({
    checkoutToken: z.string().min(1),
    cartToken: z.string().min(1).max(MAX_CART_TOKEN_LENGTH).nullable().optional(),
    checkoutCreatedAt: z.iso.datetime().nullable().optional(),
    abandonedCheckoutUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
  })
  .strict();

export type CheckoutUpdatedPayloadV3 = z.infer<
  typeof CheckoutUpdatedPayloadV3Schema
>;