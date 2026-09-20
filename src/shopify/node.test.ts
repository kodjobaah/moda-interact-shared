import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPendingRecoveryCandidateJobId,
  createShopifyCheckoutJobId,
  createShopifyDiscountSyncJobId,
  createShopifyOrderJobId,
  createShopifyWebhookJobId,
} from "./node.js";
import { parseShopifyDiscountSyncJob, SHOPIFY_DISCOUNT_SYNC_REASONS } from "./queue-contracts.js";

test("job id is deterministic", () => {
  const id1 = createShopifyWebhookJobId("app_1", "delivery_1");
  const id2 = createShopifyWebhookJobId("app_1", "delivery_1");
  assert.equal(id1, id2);
});

test("different app/delivery inputs produce different job ids", () => {
  const id1 = createShopifyWebhookJobId("app_1", "delivery_1");
  const id2 = createShopifyWebhookJobId("app_2", "delivery_1");
  const id3 = createShopifyWebhookJobId("app_1", "delivery_2");
  assert.notEqual(id1, id2);
  assert.notEqual(id1, id3);
});

test("job ids are BullMQ-safe (no colons)", () => {
  const id = createShopifyWebhookJobId("app_1", "delivery_1");
  assert.ok(id.startsWith("shopify-"));
  assert.equal(id.includes(":"), false);
});

test("checkout job ids are deterministic and resource-scoped", () => {
  const id1 = createShopifyCheckoutJobId("shop_1", "checkout_1");
  const id2 = createShopifyCheckoutJobId("shop_1", "checkout_1");
  const id3 = createShopifyCheckoutJobId("shop_2", "checkout_1");

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith("checkout-"));
  assert.equal(id1.includes(":"), false);
});

test("order job ids are deterministic and resource-scoped", () => {
  const id1 = createShopifyOrderJobId("shop_1", "gid://shopify/Order/1");
  const id2 = createShopifyOrderJobId("shop_1", "gid://shopify/Order/1");
  const id3 = createShopifyOrderJobId("shop_2", "gid://shopify/Order/1");

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith("order-created-"));
  assert.equal(id1.includes(":"), false);
});

test("pending recovery candidate id is deterministic per shop/checkout", () => {
  const id1 = createPendingRecoveryCandidateJobId("shop_1", "checkout_1");
  const id2 = createPendingRecoveryCandidateJobId("shop_1", "checkout_1");
  const id3 = createPendingRecoveryCandidateJobId("shop_2", "checkout_1");

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith("pending-recovery-"));
  assert.equal(id1.includes(":"), false);
});

test("rejects empty inputs", () => {
  assert.throws(() => createShopifyWebhookJobId("", "delivery_1"));
  assert.throws(() => createShopifyWebhookJobId("app_1", ""));
});

test("discount webhook payload requires delivery and topic", () => {
  assert.throws(() => parseShopifyDiscountSyncJob({
    schemaVersion: 1,
    shopId: "shop_1",
    shopDomain: "shop.example.com",
    reason: "DISCOUNT_WEBHOOK",
    requestedAt: "2026-09-16T12:00:00.000Z",
    deliveryId: null,
    webhookTopic: null,
  }));

  assert.throws(() => parseShopifyDiscountSyncJob({
    schemaVersion: 1,
    shopId: "shop_1",
    shopDomain: "shop.example.com",
    reason: "DISCOUNT_WEBHOOK",
    requestedAt: "2026-09-16T12:00:00.000Z",
    deliveryId: "delivery_123",
    webhookTopic: null,
  }));
});

test("admin-requested discount sync payload is accepted", () => {
  const parsed = parseShopifyDiscountSyncJob({
    schemaVersion: 1,
    shopId: "shop_1",
    shopDomain: "shop.example.com",
    reason: "ADMIN_REQUESTED",
    requestedAt: "2026-09-20T09:30:00.000Z",
    deliveryId: null,
    webhookTopic: null,
  });

  assert.equal(parsed.reason, "ADMIN_REQUESTED");
});

test("non-webhook payload rejects unexpected webhook topic", () => {
  assert.throws(() => parseShopifyDiscountSyncJob({
    schemaVersion: 1,
    shopId: "shop_1",
    shopDomain: "shop.example.com",
    reason: "SUBSCRIPTION_ACTIVATED",
    requestedAt: "2026-09-16T12:00:00.000Z",
    deliveryId: null,
    webhookTopic: "discounts/create",
  }));
});

test("discount sync job ids are deterministic and dedupe by delivery for webhooks", () => {
  const event = {
    shopId: "shop_1",
    reason: "DISCOUNT_WEBHOOK" as const,
    requestedAt: "2026-09-16T12:00:00.000Z",
    deliveryId: "delivery_123",
  };

  const id1 = createShopifyDiscountSyncJobId(event);
  const id2 = createShopifyDiscountSyncJobId({ ...event, deliveryId: "delivery_123" });
  const id3 = createShopifyDiscountSyncJobId({ ...event, deliveryId: "delivery_456" });

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith("discount-sync-"));
  assert.equal(id1.includes(":"), false);
});

test("non-webhook discount sync reasons produce bounded stable ids", () => {
  const ids = SHOPIFY_DISCOUNT_SYNC_REASONS.filter((reason) => reason !== "DISCOUNT_WEBHOOK")
    .map((reason) => createShopifyDiscountSyncJobId({
      shopId: "shop_1",
      reason,
      requestedAt: "2026-09-16T12:00:00.000Z",
    }));

  assert.equal(ids.length, 4);
  ids.forEach((id) => {
    assert.ok(id.startsWith("discount-sync-"));
    assert.equal(id.includes(":"), false);
  });
});
