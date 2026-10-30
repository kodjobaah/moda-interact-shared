import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  WOO_CART_RESTORE_SNAPSHOT_VERSION,
  WOO_RESTORE_RESOLVE_VERSION,
  WooCartRestoreLineV1Schema,
  WooCartRestoreSnapshotV1Schema,
  WooCartRestoreSupportedSnapshotV1Schema,
  WooCartRestoreUnsupportedSnapshotV1Schema,
  WooCheckoutRestoreExtensionV1Schema,
  WooRestoreOutreachOfferV1Schema,
  WooRestoreResolveRequestV1Schema,
  WooRestoreResolveResponseV1Schema,
} from "./contracts.js";

const fixture = JSON.parse(readFileSync(
  new URL("./__fixtures__/woo-restore-v1.json", import.meta.url), "utf8",
)) as Record<string, unknown>;

function assertInvalid(schema: { safeParse(input: unknown): { success: boolean } }, input: unknown): void {
  assert.equal(schema.safeParse(input).success, false);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("parses the complete supported and unsupported restoration snapshots", () => {
  assert.equal(WOO_CART_RESTORE_SNAPSHOT_VERSION, "woo.cart-restore.v1");
  assert.equal(WOO_RESTORE_RESOLVE_VERSION, "woo.restore.resolve.v1");
  assert.equal(WooCartRestoreSupportedSnapshotV1Schema.safeParse(fixture.supportedSnapshot).success, true);
  assert.equal(WooCartRestoreUnsupportedSnapshotV1Schema.safeParse(fixture.unsupportedSnapshot).success, true);
  assert.equal(WooCartRestoreSnapshotV1Schema.safeParse(fixture.supportedSnapshot).success, true);
  assert.equal(WooCartRestoreSnapshotV1Schema.safeParse(fixture.unsupportedSnapshot).success, true);

  const supported = fixture.supportedSnapshot as Record<string, unknown>;
  assert.equal(WooCartRestoreSupportedSnapshotV1Schema.safeParse({
    ...supported,
    appliedCouponCodes: [],
  }).success, true);
  assert.equal(WooCartRestoreSupportedSnapshotV1Schema.safeParse({
    ...supported,
    lines: [{ productId: "99999999999999999999", quantity: 100_000 }],
  }).success, true);
});

test("requires mutually exclusive strict supported and unsupported shapes", () => {
  const supported = fixture.supportedSnapshot as Record<string, unknown>;
  const unsupported = fixture.unsupportedSnapshot as Record<string, unknown>;
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, { ...supported, reason: "ITEMS_UNAVAILABLE" });
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, {
    ...unsupported,
    lines: [{ productId: "101", quantity: 1 }],
  });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, { ...supported, extra: true });
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, { ...unsupported, customer: "private" });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, { ...supported, appliedCouponCodes: undefined });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, { ...supported, lines: [] });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, {
    ...supported,
    lines: Array.from({ length: 51 }, () => ({ productId: "101", quantity: 1 })),
  });
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, {
    ...unsupported,
    reason: "NOT_A_REASON",
  });
  const unsupportedWithoutReason = { ...unsupported };
  delete unsupportedWithoutReason.reason;
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, unsupportedWithoutReason);
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, {
    ...supported,
    schemaVersion: "woo.cart-restore.v2",
  });
});

test("bounds line ids, quantities and variation attributes structurally", () => {
  const validLine = { productId: "101", quantity: 1 };
  for (const productId of ["0", "01", "-1", "1.2", "123456789012345678901", 101]) {
    assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, productId });
  }
  for (const variationId of ["0", "01", "123456789012345678901", 207]) {
    assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, variationId });
  }
  for (const quantity of [0, -1, 1.5, 100_001]) {
    assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, quantity });
  }

  assert.equal(WooCartRestoreLineV1Schema.safeParse({
    productId: "202",
    variationId: "207",
    quantity: 1,
    attributes: { attribute_pa_color: "navy", attribute_pa_size: "m" },
  }).success, true);
  assertInvalid(WooCartRestoreLineV1Schema, {
    ...validLine,
    attributes: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`attribute_${i}`, "value"])),
  });
  assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, attributes: { "bad\nkey": "value" } });
  assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, attributes: { key: "v".repeat(201) } });
  assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, attributes: { ["k".repeat(81)]: "value" } });
  assertInvalid(WooCartRestoreLineV1Schema, { ...validLine, title: "display field" });
});

test("requires bounded coupon lists and keeps unsupported coupon evidence non-restorable", () => {
  const supported = fixture.supportedSnapshot as Record<string, unknown>;
  const unsupported = fixture.unsupportedSnapshot as Record<string, unknown>;
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, { ...supported, appliedCouponCodes: undefined });
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, { ...unsupported, appliedCouponCodes: undefined });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, {
    ...supported,
    appliedCouponCodes: Array.from({ length: 11 }, () => "coupon"),
  });
  assertInvalid(WooCartRestoreUnsupportedSnapshotV1Schema, {
    ...unsupported,
    reason: "COUPONS_UNAVAILABLE",
    appliedCouponCodes: [],
    lines: [],
  });
  assert.equal(WooCartRestoreUnsupportedSnapshotV1Schema.safeParse({
    ...unsupported,
    reason: "COUPONS_UNAVAILABLE",
    appliedCouponCodes: [],
  }).success, true);
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, {
    ...supported,
    appliedCouponCodes: ["x".repeat(129)],
  });
  assertInvalid(WooCartRestoreSupportedSnapshotV1Schema, {
    ...supported,
    appliedCouponCodes: ["bad\ncode"],
  });
});

test("parses the optional checkout restoration extension without inventing state", () => {
  assert.deepEqual(WooCheckoutRestoreExtensionV1Schema.parse({}), {});
  for (const restoration of [fixture.supportedSnapshot, fixture.unsupportedSnapshot]) {
    assert.deepEqual(WooCheckoutRestoreExtensionV1Schema.parse({ restoration }), { restoration });
  }
  assertInvalid(WooCheckoutRestoreExtensionV1Schema, { restoration: { kind: "supported" } });
  assertInvalid(WooCheckoutRestoreExtensionV1Schema, { phone: "+44123456789" });
});

test("accepts only the exact resolver v1 request and complete eligible response", () => {
  assert.equal(WooRestoreResolveRequestV1Schema.safeParse(fixture.resolveRequest).success, true);
  assert.equal(WooRestoreResolveResponseV1Schema.safeParse(fixture.eligibleResolveResponse).success, true);
  const request = fixture.resolveRequest as Record<string, unknown>;
  const response = fixture.eligibleResolveResponse as Record<string, unknown>;
  assertInvalid(WooRestoreResolveRequestV1Schema, { ...request, schemaVersion: "woo.restore.resolve.v2" });
  assertInvalid(WooRestoreResolveRequestV1Schema, { ...request, token: "too-short" });
  assertInvalid(WooRestoreResolveRequestV1Schema, { ...request, token: "!".repeat(43) });
  assertInvalid(WooRestoreResolveRequestV1Schema, { ...request, extra: true });
  assertInvalid(WooRestoreResolveResponseV1Schema, { ...response, outreachOffer: undefined });
  assertInvalid(WooRestoreResolveResponseV1Schema, { ...response, email: "person@example.test" });
  assertInvalid(WooRestoreResolveResponseV1Schema, {
    ...response,
    snapshot: fixture.unsupportedSnapshot,
  });
  assertInvalid(WooRestoreResolveResponseV1Schema, { ...response, checkoutKey: "bad\nkey" });
});

test("parses only the four strict confirmed-outreach offer variants", () => {
  const examples = (fixture.outreachOfferExamples ?? {}) as Record<string, unknown>;
  for (const key of ["none", "unverifiable", "checkoutCode", "checkoutAutomatic", "alternativeProduct"]) {
    assert.equal(WooRestoreOutreachOfferV1Schema.safeParse(examples[key]).success, true);
  }
  assertInvalid(WooRestoreOutreachOfferV1Schema, { kind: "NONE" });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_AUTOMATIC",
    providerDiscountId: "id-1",
    code: "extra",
  });
  assertInvalid(WooRestoreOutreachOfferV1Schema, { kind: "ALTERNATIVE_PRODUCT", code: "extra" });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_CODE",
    code: "EXTRA15",
  });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_CODE",
    code: "EXTRA15",
    providerDiscountId: "id\n1",
  });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_CODE",
    code: "EXTRA15",
    providerDiscountId: "",
  });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_CODE",
    code: "x".repeat(129),
    providerDiscountId: "id-1",
  });
  assertInvalid(WooRestoreOutreachOfferV1Schema, {
    kind: "CHECKOUT_AUTOMATIC",
    providerDiscountId: "x".repeat(192),
  });
});

test("golden fixture has exactly five keys and stable schema round trips", () => {
  assert.deepEqual(Object.keys(fixture).sort(), [
    "eligibleResolveResponse",
    "outreachOfferExamples",
    "resolveRequest",
    "supportedSnapshot",
    "unsupportedSnapshot",
  ]);
  assert.deepEqual(clone(fixture), fixture);

  const supported = WooCartRestoreSupportedSnapshotV1Schema.parse(fixture.supportedSnapshot);
  const unsupported = WooCartRestoreUnsupportedSnapshotV1Schema.parse(fixture.unsupportedSnapshot);
  const request = WooRestoreResolveRequestV1Schema.parse(fixture.resolveRequest);
  const response = WooRestoreResolveResponseV1Schema.parse(fixture.eligibleResolveResponse);
  assert.deepEqual(clone(supported), fixture.supportedSnapshot);
  assert.deepEqual(clone(unsupported), fixture.unsupportedSnapshot);
  assert.deepEqual(clone(request), fixture.resolveRequest);
  assert.deepEqual(clone(response), fixture.eligibleResolveResponse);

  const offers = fixture.outreachOfferExamples as Record<string, unknown>;
  for (const example of Object.values(offers)) {
    assert.deepEqual(
      clone(WooRestoreOutreachOfferV1Schema.parse(example)),
      example,
    );
  }
});
