import { z } from "zod";

export const ShopifyCartActivityPayloadV2Schema = z
  .object({
    cartToken: z.string().min(1),
    isEmpty: z.boolean().nullable(),
  })
  .strict();

export type ShopifyCartActivityPayloadV2 = z.infer<
  typeof ShopifyCartActivityPayloadV2Schema
>;