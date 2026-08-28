import { z } from "zod";
import {
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
  SHOPIFY_RECOVERY_EVENT_TYPES_V2,
} from "../constants.js";
import { ShopifyTenantSchema } from "../common.schema.js";
import { CheckoutCreatedPayloadV2Schema } from "./checkout-created.schema.js";
import { CheckoutUpdatedPayloadV2Schema } from "./checkout-updated.schema.js";
import { OrderCompletedPayloadV2Schema } from "./order-completed.schema.js";

const ShopifyRecoveryEventBaseV2Schema = z
  .object({
    schemaVersion: z.literal(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2),
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
  })
  .strict();

export const ShopifyCheckoutCreatedEventV2Schema =
  ShopifyRecoveryEventBaseV2Schema.extend({
    eventType: z.literal(SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_CREATED),
    payload: CheckoutCreatedPayloadV2Schema,
  }).strict();

export type ShopifyCheckoutCreatedEventV2 = z.infer<
  typeof ShopifyCheckoutCreatedEventV2Schema
>;

export const ShopifyCheckoutUpdatedEventV2Schema =
  ShopifyRecoveryEventBaseV2Schema.extend({
    eventType: z.literal(SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_UPDATED),
    payload: CheckoutUpdatedPayloadV2Schema,
  }).strict();

export type ShopifyCheckoutUpdatedEventV2 = z.infer<
  typeof ShopifyCheckoutUpdatedEventV2Schema
>;

export const ShopifyOrderCompletedEventV2Schema =
  ShopifyRecoveryEventBaseV2Schema.extend({
    eventType: z.literal(SHOPIFY_RECOVERY_EVENT_TYPES_V2.ORDER_COMPLETED),
    payload: OrderCompletedPayloadV2Schema,
  }).strict();

export type ShopifyOrderCompletedEventV2 = z.infer<
  typeof ShopifyOrderCompletedEventV2Schema
>;

export const ShopifyRecoveryEventV2Schema = z.discriminatedUnion("eventType", [
  ShopifyCheckoutCreatedEventV2Schema,
  ShopifyCheckoutUpdatedEventV2Schema,
  ShopifyOrderCompletedEventV2Schema,
]);

export type ShopifyRecoveryEventV2 = z.infer<typeof ShopifyRecoveryEventV2Schema>;
export type ShopifyRecoveryEventTypeV2 = ShopifyRecoveryEventV2["eventType"];

export function parseShopifyRecoveryEventV2(input: unknown): ShopifyRecoveryEventV2 {
  return ShopifyRecoveryEventV2Schema.parse(input);
}

export function safeParseShopifyRecoveryEventV2(input: unknown) {
  return ShopifyRecoveryEventV2Schema.safeParse(input);
}

export function isCheckoutCreatedEventV2(
  event: ShopifyRecoveryEventV2,
): event is ShopifyCheckoutCreatedEventV2 {
  return event.eventType === SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_CREATED;
}

export function isCheckoutUpdatedEventV2(
  event: ShopifyRecoveryEventV2,
): event is ShopifyCheckoutUpdatedEventV2 {
  return event.eventType === SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_UPDATED;
}

export function isOrderCompletedEventV2(
  event: ShopifyRecoveryEventV2,
): event is ShopifyOrderCompletedEventV2 {
  return event.eventType === SHOPIFY_RECOVERY_EVENT_TYPES_V2.ORDER_COMPLETED;
}

export function createShopifyPendingRecoveryOrderingKey(
  shopId: string,
  checkoutToken: string,
): string {
  if (typeof shopId !== "string" || shopId.length === 0) {
    throw new Error(
      "createShopifyPendingRecoveryOrderingKey: shopId must be a non-empty string",
    );
  }

  if (typeof checkoutToken !== "string" || checkoutToken.length === 0) {
    throw new Error(
      "createShopifyPendingRecoveryOrderingKey: checkoutToken must be a non-empty string",
    );
  }

  return `${shopId}:${checkoutToken}`;
}

export function createShopifyOrderCorrelationOrderingKey(input: {
  shopId: string;
  orderId: string;
  checkoutToken: string | null;
}): string {
  if (input.checkoutToken) {
    return createShopifyPendingRecoveryOrderingKey(input.shopId, input.checkoutToken);
  }

  if (typeof input.orderId !== "string" || input.orderId.length === 0) {
    throw new Error(
      "createShopifyOrderCorrelationOrderingKey: orderId must be a non-empty string",
    );
  }

  if (typeof input.shopId !== "string" || input.shopId.length === 0) {
    throw new Error(
      "createShopifyOrderCorrelationOrderingKey: shopId must be a non-empty string",
    );
  }

  return `${input.shopId}:${input.orderId}`;
}
