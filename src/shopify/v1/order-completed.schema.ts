import { z } from "zod";
import { ShopifyMoneySchema } from "../common.schema.js";

export const OrderCompletedPayloadSchema = z
  .object({
    orderId: z.string().min(1),
    checkoutToken: z.string().min(1).nullable(),
    shopifyCustomerId: z.string().min(1).nullable(),
    total: ShopifyMoneySchema.nullable(),
    completedAt: z.iso.datetime(),
  })
  .strict();

export type OrderCompletedPayload = z.infer<typeof OrderCompletedPayloadSchema>;
