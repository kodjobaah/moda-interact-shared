import { createHash } from "node:crypto";

/**
 * Deterministic, BullMQ-safe job ID: "shopify-<sha256(appKey + ":" + deliveryId)>".
 * The hex digest contains no colons and no secret material, only a one-way hash.
 */
export function createShopifyWebhookJobId(appKey: string, deliveryId: string): string {
  if (typeof appKey !== "string" || appKey.length === 0) {
    throw new Error("createShopifyWebhookJobId: appKey must be a non-empty string");
  }
  if (typeof deliveryId !== "string" || deliveryId.length === 0) {
    throw new Error("createShopifyWebhookJobId: deliveryId must be a non-empty string");
  }

  const digest = createHash("sha256").update(`${appKey}:${deliveryId}`).digest("hex");
  return `shopify-${digest}`;
}
