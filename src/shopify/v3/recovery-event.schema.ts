import { z } from "zod";
import {
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3,
  SHOPIFY_RECOVERY_EVENT_TYPES_V3,
} from "../constants.js";
import { ShopifyTenantSchema } from "../common.schema.js";
import { InternationalContextSchema } from "../../internationalization.js";
import { CheckoutUpdatedPayloadV3Schema } from "./checkout-updated.schema.js";

const ShopifyRecoveryEventBaseV3Schema = z
  .object({
    schemaVersion: z.literal(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3),
    receiptId: z.string().min(1),
    deliveryId: z.string().min(1),
    eventId: z.string().min(1).nullable(),
    source: z.literal("shopify"),
    providerTopic: z.string().min(1),
    tenant: ShopifyTenantSchema,
    occurredAt: z.iso.datetime().nullable(),
    receivedAt: z.iso.datetime(),
    traceId: z.string().min(1),
    orderingKey: z.string().min(1),
    internationalContext: InternationalContextSchema.optional(),
  })
  .strict();

export const ShopifyCheckoutUpdatedEventV3Schema =
  ShopifyRecoveryEventBaseV3Schema.extend({
    eventType: z.literal(SHOPIFY_RECOVERY_EVENT_TYPES_V3.CHECKOUT_UPDATED),
    payload: CheckoutUpdatedPayloadV3Schema,
  }).strict();

export type ShopifyCheckoutUpdatedEventV3 = z.infer<
  typeof ShopifyCheckoutUpdatedEventV3Schema
>;
