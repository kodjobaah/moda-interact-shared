import { z } from "zod";

export const OrderCompletedPayloadV2Schema = z
  .object({
    orderId: z.string().min(1),
    checkoutToken: z.string().min(1).nullable(),
    cartToken: z.string().min(1).nullable(),
    completedAt: z.iso.datetime(),
  })
  .strict();

export type OrderCompletedPayloadV2 = z.infer<typeof OrderCompletedPayloadV2Schema>;
