import assert from "node:assert/strict";
import { test } from "node:test";
import { createShopifyWebhookJobId } from "./node.js";

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

test("rejects empty inputs", () => {
  assert.throws(() => createShopifyWebhookJobId("", "delivery_1"));
  assert.throws(() => createShopifyWebhookJobId("app_1", ""));
});
