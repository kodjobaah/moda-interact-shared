import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPendingRecoveryCandidateJobId,
  createShopifyCheckoutJobId,
  createShopifyOrderJobId,
  createShopifyWebhookJobId,
} from "./node.js";

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
