import { z } from "zod";

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
  SHOPIFY_DISCOUNT_SYNC: {
    queueName: "shopify-discount-sync",
    jobName: "reconcile-shopify-discounts",
  },
} as const;

export const SHOPIFY_DISCOUNT_SYNC_REASONS = [
  "SUBSCRIPTION_ACTIVATED",
  "REINSTALL_RECONCILED",
  "SCOPES_UPDATED",
  "ADMIN_REQUESTED",
  "DISCOUNT_WEBHOOK",
] as const;

export const SHOPIFY_DISCOUNT_SYNC_WEBHOOK_TOPICS = [
  "discounts/create",
  "discounts/update",
  "discounts/delete",
  "discounts/redeemcode_added",
  "discounts/redeemcode_removed",
] as const;

export const ShopifyDiscountSyncReasonSchema = z.enum(SHOPIFY_DISCOUNT_SYNC_REASONS);
export const ShopifyDiscountSyncWebhookTopicSchema = z.enum(SHOPIFY_DISCOUNT_SYNC_WEBHOOK_TOPICS);

export const ShopifyDiscountSyncJobSchema = z
  .object({
    schemaVersion: z.literal(1),
    shopId: z.string().trim().min(1).max(128),
    shopDomain: z.string().trim().min(1).max(512),
    reason: ShopifyDiscountSyncReasonSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    deliveryId: z.string().trim().min(1).nullable(),
    webhookTopic: ShopifyDiscountSyncWebhookTopicSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === "DISCOUNT_WEBHOOK") {
      if (!value.deliveryId || value.deliveryId.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["deliveryId"],
          message: "deliveryId is required when reason is DISCOUNT_WEBHOOK",
        });
      }

      if (value.webhookTopic === null) {
        ctx.addIssue({
          code: "custom",
          path: ["webhookTopic"],
          message: "webhookTopic is required when reason is DISCOUNT_WEBHOOK",
        });
      }
    } else {
      if (value.webhookTopic !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["webhookTopic"],
          message: "webhookTopic must be null when reason is not DISCOUNT_WEBHOOK",
        });
      }
    }
  });

export type ShopifyDiscountSyncJob = z.infer<typeof ShopifyDiscountSyncJobSchema>;

export function parseShopifyDiscountSyncJob(input: unknown): ShopifyDiscountSyncJob {
  return ShopifyDiscountSyncJobSchema.parse(input);
}

export function safeParseShopifyDiscountSyncJob(input: unknown) {
  return ShopifyDiscountSyncJobSchema.safeParse(input);
}
