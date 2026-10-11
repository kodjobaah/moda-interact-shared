import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
  SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3,
  SHOPIFY_RECOVERY_EVENT_TYPES_V2,
  SHOPIFY_RECOVERY_EVENT_TYPES_V3,
  parseShopifyRecoveryEvent,
  parseShopifyRecoveryEventV2,
  safeParseShopifyRecoveryEvent,
} from "./index.js";

const tenant = { shopId: "shop_1", shopDomain: "example.myshopify.com" };

function baseEnvelope(schemaVersion: number) {
  return {
    schemaVersion,
    receiptId: "receipt_1",
    deliveryId: "delivery_1",
    eventId: "event_1",
    source: "shopify" as const,
    providerTopic: "checkouts/update",
    tenant,
    occurredAt: "2026-10-01T09:30:00.000Z",
    receivedAt: "2026-10-01T09:30:01.000Z",
    traceId: "trace_1",
    orderingKey: "shop_1:checkout_1",
  };
}

function checkoutUpdatedV2Event() {
  return {
    ...baseEnvelope(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2),
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_UPDATED,
    payload: { checkoutToken: "checkout_1" },
  };
}

function checkoutUpdatedV3Event(payload: Record<string, unknown> = { checkoutToken: "checkout_1" }) {
  return {
    ...baseEnvelope(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3),
    eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V3.CHECKOUT_UPDATED,
    payload,
  };
}

test("canonical parser accepts unchanged v2 checkout.updated and v3 checkout.updated", () => {
  const v2 = parseShopifyRecoveryEvent(checkoutUpdatedV2Event());
  const v3 = parseShopifyRecoveryEvent(checkoutUpdatedV3Event());

  assert.equal(v2.schemaVersion, SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2);
  assert.deepEqual(v2.payload, { checkoutToken: "checkout_1" });
  assert.equal(v3.schemaVersion, SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3);
  assert.deepEqual(v3.payload, { checkoutToken: "checkout_1" });
});

test("v3 checkout.updated accepts absent and nullable lookup context", () => {
  const absent = parseShopifyRecoveryEvent(checkoutUpdatedV3Event());
  const nullable = parseShopifyRecoveryEvent(checkoutUpdatedV3Event({
    checkoutToken: "checkout_1",
    cartToken: null,
    checkoutCreatedAt: null,
    abandonedCheckoutUrl: null,
  }));
  const populated = parseShopifyRecoveryEvent(checkoutUpdatedV3Event({
    checkoutToken: "checkout_1",
    cartToken: "cart_1",
    checkoutCreatedAt: "2026-10-01T09:30:00.000Z",
    abandonedCheckoutUrl: "https://example.myshopify.com/checkouts/checkout_1",
  }));

  assert.deepEqual(absent.payload, { checkoutToken: "checkout_1" });
  if (nullable.schemaVersion !== SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3) {
    assert.fail("expected a v3 checkout.updated event");
  }
  assert.equal(nullable.payload.checkoutCreatedAt, null);
  if (populated.schemaVersion !== SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V3) {
    assert.fail("expected a v3 checkout.updated event");
  }
  assert.equal(populated.payload.checkoutToken, "checkout_1");
  assert.equal(populated.orderingKey, "shop_1:checkout_1");
});

test("canonical parser retains the remaining v2 recovery event variants", () => {
  const events = [
    {
      ...baseEnvelope(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2),
      eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CHECKOUT_CREATED,
      providerTopic: "checkouts/create",
      payload: {
        checkoutToken: "checkout_1",
        cartToken: null,
        abandonedCheckoutUrl: null,
        checkoutCreatedAt: null,
      },
    },
    {
      ...baseEnvelope(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2),
      eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.CART_ACTIVITY,
      providerTopic: "carts/update",
      payload: { cartToken: "cart_1", isEmpty: null },
    },
    {
      ...baseEnvelope(SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2),
      eventType: SHOPIFY_RECOVERY_EVENT_TYPES_V2.ORDER_COMPLETED,
      providerTopic: "orders/create",
      payload: {
        orderId: "gid://shopify/Order/123",
        checkoutToken: null,
        cartToken: null,
        completedAt: "2026-10-01T09:35:00.000Z",
      },
    },
  ];

  assert.deepEqual(events.map((event) => parseShopifyRecoveryEvent(event).eventType), [
    "checkout.created",
    "cart.activity",
    "order.completed",
  ]);
});

test("v2 parser rejects v3-shaped context and canonical parser requires the v3 version", () => {
  const v3PayloadLabelledV2 = {
    ...checkoutUpdatedV2Event(),
    payload: {
      checkoutToken: "checkout_1",
      cartToken: "cart_1",
    },
  };
  const v2VersionLabelledV3 = {
    ...checkoutUpdatedV3Event({ checkoutToken: "checkout_1", cartToken: "cart_1" }),
    schemaVersion: SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2,
  };

  assert.throws(() => parseShopifyRecoveryEventV2(v3PayloadLabelledV2));
  assert.equal(safeParseShopifyRecoveryEvent(v2VersionLabelledV3).success, false);
});

test("v3 checkout.updated rejects malformed and oversized optional context", () => {
  for (const payload of [
    { checkoutToken: "checkout_1", cartToken: "" },
    { checkoutToken: "checkout_1", cartToken: "c".repeat(101) },
    { checkoutToken: "checkout_1", checkoutCreatedAt: "not-a-date" },
    { checkoutToken: "checkout_1", abandonedCheckoutUrl: "not-a-url" },
    { checkoutToken: "checkout_1", abandonedCheckoutUrl: `https://example.com/${"x".repeat(2048)}` },
  ]) {
    assert.equal(safeParseShopifyRecoveryEvent(checkoutUpdatedV3Event(payload)).success, false);
  }
});

test("v3 checkout.updated rejects unknown payload and envelope fields", () => {
  assert.equal(safeParseShopifyRecoveryEvent(checkoutUpdatedV3Event({
    checkoutToken: "checkout_1",
    unexpected: true,
  })).success, false);
  assert.equal(safeParseShopifyRecoveryEvent({
    ...checkoutUpdatedV3Event(),
    unexpected: true,
  }).success, false);
});