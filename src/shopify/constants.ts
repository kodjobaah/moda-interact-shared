export const SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V1 = 1 as const;
export const SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2 = 2 as const;

// Backward-compatible alias for existing v1 callers.
export const SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION =
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V1;

export const SHOPIFY_COMMERCE_EVENT_TYPES = {
  CHECKOUT_OBSERVED: "checkout.observed",
  ORDER_COMPLETED: "order.completed",
} as const;

export const SHOPIFY_RECOVERY_EVENT_TYPES_V2 = {
  CHECKOUT_CREATED: "checkout.created",
  CHECKOUT_UPDATED: "checkout.updated",
  ORDER_COMPLETED: "order.completed",
} as const;

export const SHOPIFY_WEBHOOK_OUTBOX_DESTINATIONS = {
  CHECKOUT_EVENTS: "CHECKOUT_EVENTS",
  ORDER_EVENTS: "ORDER_EVENTS",
} as const;
