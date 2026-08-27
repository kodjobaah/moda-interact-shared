import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ShopifyCommerceEventSchema,
  parseShopifyCommerceEvent,
  safeParseShopifyCommerceEvent,
  createShopifyCommerceOrderingKey,
  createShopifyOrderOrderingKey,
} from "./commerce-event.schema.js";
import { SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION } from "./constants.js";

const tenant = { shopId: "shop_1", shopDomain: "example.myshopify.com" };

function baseEnvelope() {
  return {
    schemaVersion: SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION,
    receiptId: "receipt_1",
    deliveryId: "delivery_1",
    eventId: "evt_1",
    source: "shopify" as const,
    providerTopic: "checkouts/update",
    tenant,
    occurredAt: "2024-01-01T00:00:00.000Z",
    receivedAt: "2024-01-01T00:00:01.000Z",
    traceId: "trace_1",
    orderingKey: createShopifyCommerceOrderingKey(tenant.shopId, "checkout_1"),
  };
}

function checkoutObservedEvent() {
  return {
    ...baseEnvelope(),
    eventType: "checkout.observed" as const,
    payload: {
      checkoutToken: "checkout_1",
      cartToken: null,
      checkoutUrl: null,
      customer: null,
      total: { amount: "12.34", currencyCode: "USD" },
      lineItems: [],
      checkoutCreatedAt: null,
      checkoutUpdatedAt: null,
      completedAt: null,
    },
  };
}

function orderCompletedEvent() {
  return {
    ...baseEnvelope(),
    eventType: "order.completed" as const,
    payload: {
      orderId: "order_1",
      checkoutToken: "checkout_1",
      shopifyCustomerId: null,
      total: { amount: "12.34", currencyCode: "USD" },
      completedAt: "2024-01-01T00:05:00.000Z",
    },
  };
}

function orderCompletedEventWithoutCheckoutToken() {
  return {
    ...baseEnvelope(),
    eventType: "order.completed" as const,
    payload: {
      orderId: "order_1",
      checkoutToken: null,
      shopifyCustomerId: null,
      total: null,
      completedAt: "2024-01-01T00:05:00.000Z",
    },
  };
}

test("parses a valid checkout.observed event", () => {
  const event = parseShopifyCommerceEvent(checkoutObservedEvent());
  assert.equal(event.eventType, "checkout.observed");
});

test("parses a valid order.completed event", () => {
  const event = parseShopifyCommerceEvent(orderCompletedEvent());
  assert.equal(event.eventType, "order.completed");
});

test("parses a valid order.completed event without a checkout token", () => {
  const event = parseShopifyCommerceEvent(orderCompletedEventWithoutCheckoutToken());
  assert.equal(event.eventType, "order.completed");
  assert.equal(event.payload.checkoutToken, null);
});

test("eventType selects the correct payload shape", () => {
  const event = parseShopifyCommerceEvent(checkoutObservedEvent());
  if (event.eventType === "checkout.observed") {
    assert.equal(event.payload.checkoutToken, "checkout_1");
  } else {
    assert.fail("expected checkout.observed");
  }
});

test("rejects checkout payload paired with order.completed eventType", () => {
  const invalid = {
    ...baseEnvelope(),
    eventType: "order.completed",
    payload: checkoutObservedEvent().payload,
  };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects unsupported schemaVersion", () => {
  const invalid = { ...checkoutObservedEvent(), schemaVersion: 2 };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects unknown eventType", () => {
  const invalid = { ...checkoutObservedEvent(), eventType: "checkout.abandoned" };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects unknown properties", () => {
  const invalid = { ...checkoutObservedEvent(), extra: "nope" };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects invalid timestamps", () => {
  const invalid = {
    ...checkoutObservedEvent(),
    receivedAt: "not-a-date",
  };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects floating-point money amounts", () => {
  const event = checkoutObservedEvent();
  const invalid = {
    ...event,
    payload: { ...event.payload, total: { amount: 12.34, currencyCode: "USD" } },
  };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects invalid currency codes", () => {
  const event = checkoutObservedEvent();
  const invalid = {
    ...event,
    payload: { ...event.payload, total: { amount: "12.34", currencyCode: "us" } },
  };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("rejects missing checkoutToken", () => {
  const event = checkoutObservedEvent();
  const { checkoutToken: _checkoutToken, ...rest } = event.payload;
  const invalid = { ...event, payload: rest };
  assert.throws(() => parseShopifyCommerceEvent(invalid));
});

test("enforces line-item limits", () => {
  const event = checkoutObservedEvent();
  const lineItem = {
    lineItemId: "li_1",
    variantId: null,
    productId: null,
    title: "Item",
    variantTitle: null,
    quantity: 1,
    unitPrice: "1.00",
    sku: null,
  };
  const invalid = {
    ...event,
    payload: { ...event.payload, lineItems: Array.from({ length: 251 }, () => lineItem) },
  };
  assert.throws(() => parseShopifyCommerceEvent(invalid));

  const valid = {
    ...event,
    payload: { ...event.payload, lineItems: Array.from({ length: 250 }, () => lineItem) },
  };
  assert.doesNotThrow(() => parseShopifyCommerceEvent(valid));
});

test("safeParse returns a structured validation failure", () => {
  const result = safeParseShopifyCommerceEvent({ not: "an event" });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.length > 0);
  }
});

test("ordering key is deterministic", () => {
  const key1 = createShopifyCommerceOrderingKey("shop_1", "checkout_1");
  const key2 = createShopifyCommerceOrderingKey("shop_1", "checkout_1");
  assert.equal(key1, key2);
});

test("checkout and order events for the same shop/checkout share an ordering key", () => {
  const key = createShopifyCommerceOrderingKey("shop_1", "checkout_1");
  assert.equal(key, "shop_1:checkout_1");
});

test("different shops produce different ordering keys", () => {
  const key1 = createShopifyCommerceOrderingKey("shop_1", "checkout_1");
  const key2 = createShopifyCommerceOrderingKey("shop_2", "checkout_1");
  assert.notEqual(key1, key2);
});

test("ordering key rejects empty inputs", () => {
  assert.throws(() => createShopifyCommerceOrderingKey("", "checkout_1"));
  assert.throws(() => createShopifyCommerceOrderingKey("shop_1", ""));
});

test("order ordering key falls back to order id", () => {
  const key = createShopifyOrderOrderingKey("shop_1", "order_1");
  assert.equal(key, "shop_1:order_1");
});

test("root discriminated union schema matches parseShopifyCommerceEvent", () => {
  const result = ShopifyCommerceEventSchema.safeParse(checkoutObservedEvent());
  assert.equal(result.success, true);
});
