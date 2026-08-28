import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION,
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
  SHOPIFY_RECOVERY_EVENT_TYPES_V2,
} from "../constants.js";
import {
  createShopifyOrderCorrelationOrderingKey,
  createShopifyPendingRecoveryOrderingKey,
  parseShopifyRecoveryEventV2,
  safeParseShopifyRecoveryEventV2,
} from "./recovery-event.schema.js";
import { parseShopifyCommerceEvent } from "../v1/commerce-event.schema.js";

const tenant = { shopId: "shop_1", shopDomain: "example.myshopify.com" };

function baseEnvelope() {
  return {
    schemaVersion: SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
    receiptId: "receipt_1",
    deliveryId: "delivery_1",
    eventId: "evt_1",
    source: "shopify" as const,
    providerTopic: "checkouts/create",
    tenant,
    occurredAt: "2024-01-01T00:00:00.000Z",
    receivedAt: "2024-01-01T00:00:01.000Z",
    traceId: "trace_1",
    orderingKey: createShopifyPendingRecoveryOrderingKey(
      tenant.shopId,
      "checkout_1",
    ),
  };
}

function checkoutCreatedV2Event() {
  return {
    ...baseEnvelope(),
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_CREATED,
    payload: {
      checkoutToken: "checkout_1",
      cartToken: null,
      abandonedCheckoutUrl: null,
      checkoutCreatedAt: null,
    },
  };
}

function checkoutUpdatedV2Event() {
  return {
    ...baseEnvelope(),
    providerTopic: "checkouts/update",
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_UPDATED,
    payload: {
      checkoutToken: "checkout_1",
    },
  };
}

function orderCompletedV2Event() {
  return {
    ...baseEnvelope(),
    providerTopic: "orders/create",
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.ORDER_COMPLETED,
    payload: {
      orderId: "gid://shopify/Order/123",
      checkoutToken: null,
      cartToken: null,
      completedAt: "2024-01-01T00:05:00.000Z",
    },
  };
}

test("parses v2 checkout.created", () => {
  const event = parseShopifyRecoveryEventV2(checkoutCreatedV2Event());
  assert.equal(event.eventType, "checkout.created");
});

test("parses v2 checkout.updated with only checkoutToken", () => {
  const event = parseShopifyRecoveryEventV2(checkoutUpdatedV2Event());
  assert.equal(event.eventType, "checkout.updated");
  assert.deepEqual(Object.keys(event.payload), ["checkoutToken"]);
});

test("parses v2 order.completed with nullable correlation identifiers", () => {
  const event = parseShopifyRecoveryEventV2(orderCompletedV2Event());
  assert.equal(event.eventType, "order.completed");
  assert.equal(event.payload.checkoutToken, null);
  assert.equal(event.payload.cartToken, null);
});

test("rejects v2 checkout.created payload carrying pre-recovery basket/customer fields", () => {
  const invalid = {
    ...checkoutCreatedV2Event(),
    payload: {
      ...checkoutCreatedV2Event().payload,
      customer: { email: "x@example.com" },
    },
  };

  assert.throws(() => parseShopifyRecoveryEventV2(invalid));
});

test("rejects v2 checkout.updated payload carrying extra fields", () => {
  const invalid = {
    ...checkoutUpdatedV2Event(),
    payload: {
      checkoutToken: "checkout_1",
      cartToken: "cart_1",
    },
  };

  assert.throws(() => parseShopifyRecoveryEventV2(invalid));
});

test("rejects v2 order.completed without cartToken", () => {
  const valid = orderCompletedV2Event();
  const { cartToken: _cartToken, ...payloadWithoutCartToken } = valid.payload;
  const invalid = {
    ...valid,
    payload: payloadWithoutCartToken,
  };

  assert.throws(() => parseShopifyRecoveryEventV2(invalid));
});

test("safeParse v2 returns structured error for invalid schema", () => {
  const result = safeParseShopifyRecoveryEventV2({
    schemaVersion: SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_UPDATED,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.length > 0);
  }
});

test("order correlation helper prefers checkoutToken when present", () => {
  const key = createShopifyOrderCorrelationOrderingKey({
    shopId: "shop_1",
    orderId: "gid://shopify/Order/123",
    checkoutToken: "checkout_1",
  });

  assert.equal(key, "shop_1:checkout_1");
});

test("order correlation helper falls back to orderId when checkoutToken is null", () => {
  const key = createShopifyOrderCorrelationOrderingKey({
    shopId: "shop_1",
    orderId: "gid://shopify/Order/123",
    checkoutToken: null,
  });

  assert.equal(key, "shop_1:gid://shopify/Order/123");
});

test("pending-recovery ordering key is deterministic and tenant-scoped", () => {
  const key1 = createShopifyPendingRecoveryOrderingKey("shop_1", "checkout_1");
  const key2 = createShopifyPendingRecoveryOrderingKey("shop_1", "checkout_1");
  const key3 = createShopifyPendingRecoveryOrderingKey("shop_2", "checkout_1");

  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
});

test("v1 parser remains importable/parseable for transition", () => {
  const v1CheckoutObserved = {
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
    orderingKey: "shop_1:checkout_1",
    eventType: "checkout.observed" as const,
    payload: {
      checkoutToken: "checkout_1",
      cartToken: null,
      checkoutUrl: null,
      customer: null,
      total: null,
      lineItems: [],
      checkoutCreatedAt: null,
      checkoutUpdatedAt: null,
      completedAt: null,
    },
  };

  const parsed = parseShopifyCommerceEvent(v1CheckoutObserved);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.eventType, "checkout.observed");
});
