import { createHash } from "node:crypto";

function createShopifyWebhookJobDigest(prefix: string, first: string, second: string): string {
  if (typeof first !== "string" || first.length === 0) {
    throw new Error(`${prefix}: first input must be a non-empty string`);
  }

  if (typeof second !== "string" || second.length === 0) {
    throw new Error(`${prefix}: second input must be a non-empty string`);
  }

  const digest = createHash("sha256").update(`${first}:${second}`).digest("hex");
  return `${prefix}-${digest}`;
}

/**
 * Legacy webhook delivery job id used by earlier receipt/outbox flows.
 * Prefer the resource-scoped helpers below for current queue publication.
 */
export function createShopifyWebhookJobId(appKey: string, deliveryId: string): string {
  return createShopifyWebhookJobDigest("shopify", appKey, deliveryId);
}

export function createShopifyCheckoutJobId(shopId: string, checkoutToken: string): string {
  return createShopifyWebhookJobDigest("checkout", shopId, checkoutToken);
}

export function createShopifyOrderJobId(shopId: string, orderGid: string): string {
  return createShopifyWebhookJobDigest("order-created", shopId, orderGid);
}
