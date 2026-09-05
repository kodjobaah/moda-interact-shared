export const SHOPIFY_WEBHOOK_QUEUE_CONTRACTS = {
  CHECKOUT_EVENTS: {
    queueName: "checkout-events",
    jobName: "checkout-created",
  },
  CHECKOUT_UPDATED_EVENTS: {
    queueName: "checkout-events",
    jobName: "checkout-updated",
  },
  CART_ACTIVITY_EVENTS: {
    queueName: "checkout-events",
    jobName: "cart-activity",
  },
  ORDER_EVENTS: {
    queueName: "order-events",
    jobName: "order-completed",
  },
} as const;
