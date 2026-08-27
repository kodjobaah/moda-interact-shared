export const SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION = 1 as const;

export const SHOPIFY_COMMERCE_QUEUE = "commerce-events" as const;
export const SHOPIFY_COMMERCE_JOB = "shopify-commerce-event" as const;

export const SHOPIFY_COMMERCE_EVENT_TYPES = {
  CHECKOUT_OBSERVED: "checkout.observed",
  ORDER_COMPLETED: "order.completed",
} as const;
