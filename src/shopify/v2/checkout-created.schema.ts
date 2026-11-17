import { z } from "zod";
import { MAX_URL_LENGTH } from "../common.schema.js";

export const CheckoutCreatedPayloadV2Schema = z
  .object({
    checkoutToken: z.string().min(1),
    cartToken: z.string().min(1).nullable(),
    abandonedCheckoutUrl: z.url().max(MAX_URL_LENGTH).nullable(),
    checkoutCreatedAt: z.iso.datetime().nullable(),
    // ARCH-077 optional cart-correlation marker transport. Optional for legacy
    // queued events; pair semantics (PRESENT requires exactly one marker) are
    // enforced by the producer/consumer, not by this schema.
    cartCorrelationMarker: z
      .string()
      .regex(/^m1_[A-Za-z0-9_-]{43}$/)
      .optional(),
    cartCorrelationMarkerStatus: z
      .enum(["PRESENT", "ABSENT", "INVALID", "AMBIGUOUS"])
      .optional(),
  })
  .strict();

export type CheckoutCreatedPayloadV2 = z.infer<
  typeof CheckoutCreatedPayloadV2Schema
>;
