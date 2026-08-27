import { z } from "zod";
import {
  MAX_URL_LENGTH,
  ShopifyCheckoutLineItemsSchema,
  ShopifyCustomerReferenceSchema,
  ShopifyMoneySchema,
} from "./common.schema.js";

export const CheckoutObservedPayloadSchema = z
  .object({
    checkoutToken: z.string().min(1),
    cartToken: z.string().min(1).nullable(),
    checkoutUrl: z.url().max(MAX_URL_LENGTH).nullable(),
    customer: ShopifyCustomerReferenceSchema.nullable(),
    total: ShopifyMoneySchema.nullable(),
    lineItems: ShopifyCheckoutLineItemsSchema,
    checkoutCreatedAt: z.iso.datetime().nullable(),
    checkoutUpdatedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type CheckoutObservedPayload = z.infer<typeof CheckoutObservedPayloadSchema>;
