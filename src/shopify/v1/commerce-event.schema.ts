import { z } from "zod";
import {
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION,
  SHOPIFY_COMMERCE_EVENT_TYPES,
} from "../constants.js";
import { ShopifyTenantSchema } from "../common.schema.js";
import { CheckoutObservedPayloadSchema } from "./checkout-observed.schema.js";
import { OrderCompletedPayloadSchema } from "./order-completed.schema.js";

const ShopifyCommerceEventBaseSchema = z.object({
  schemaVersion: z.literal(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION),
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
});

export const ShopifyCheckoutObservedEventSchema = ShopifyCommerceEventBaseSchema.extend({
  eventType: z.literal(SHOPIFY_COMMERCE_EVENT_TYPES.CHECKOUT_OBSERVED),
  payload: CheckoutObservedPayloadSchema,
}).strict();

export type ShopifyCheckoutObservedEvent = z.infer<
  typeof ShopifyCheckoutObservedEventSchema
>;

export const ShopifyOrderCompletedEventSchema = ShopifyCommerceEventBaseSchema.extend({
  eventType: z.literal(SHOPIFY_COMMERCE_EVENT_TYPES.ORDER_COMPLETED),
  payload: OrderCompletedPayloadSchema,
}).strict();

export type ShopifyOrderCompletedEvent = z.infer<
  typeof ShopifyOrderCompletedEventSchema
>;

export const ShopifyCommerceEventSchema = z.discriminatedUnion("eventType", [
  ShopifyCheckoutObservedEventSchema,
  ShopifyOrderCompletedEventSchema,
]);

export type ShopifyCommerceEvent = z.infer<typeof ShopifyCommerceEventSchema>;
export type ShopifyCommerceEventType = ShopifyCommerceEvent["eventType"];

export function parseShopifyCommerceEvent(input: unknown): ShopifyCommerceEvent {
  return ShopifyCommerceEventSchema.parse(input);
}

export function safeParseShopifyCommerceEvent(input: unknown) {
  return ShopifyCommerceEventSchema.safeParse(input);
}

export function isCheckoutObservedEvent(
  event: ShopifyCommerceEvent,
): event is ShopifyCheckoutObservedEvent {
  return event.eventType === SHOPIFY_COMMERCE_EVENT_TYPES.CHECKOUT_OBSERVED;
}

export function isOrderCompletedEvent(
  event: ShopifyCommerceEvent,
): event is ShopifyOrderCompletedEvent {
  return event.eventType === SHOPIFY_COMMERCE_EVENT_TYPES.ORDER_COMPLETED;
}

/**
 * Stable ordering key for a shop/checkout pair.
 * Checkout and order events for the same checkout must share this key, so
 * deliveryId is intentionally excluded.
 */
export function createShopifyCommerceOrderingKey(
  shopId: string,
  checkoutToken: string,
): string {
  if (typeof shopId !== "string" || shopId.length === 0) {
    throw new Error(
      "createShopifyCommerceOrderingKey: shopId must be a non-empty string",
    );
  }

  if (typeof checkoutToken !== "string" || checkoutToken.length === 0) {
    throw new Error(
      "createShopifyCommerceOrderingKey: checkoutToken must be a non-empty string",
    );
  }

  return `${shopId}:${checkoutToken}`;
}

export function createShopifyOrderOrderingKey(
  shopId: string,
  orderId: string,
): string {
  if (typeof shopId !== "string" || shopId.length === 0) {
    throw new Error(
      "createShopifyOrderOrderingKey: shopId must be a non-empty string",
    );
  }

  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error(
      "createShopifyOrderOrderingKey: orderId must be a non-empty string",
    );
  }

  return `${shopId}:${orderId}`;
}