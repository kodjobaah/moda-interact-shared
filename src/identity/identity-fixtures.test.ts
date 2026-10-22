import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  normalizeRecipientPhone,
  parseShopifyCustomerIdentity,
  ShopifyCustomerIdentityError,
  areSameShopifyCustomerWithinShop,
  isShopifyCustomerNumericId,
} from "./index.js";

interface IdentityFixtures {
  schemaVersion: number;
  phoneCases: Array<{
    id: string; input: string; verifiedCountryCode: string | null;
    e164?: string; reject?: string;
  }>;
  shopifyCustomerCases: Array<{
    id: string; input: string | number; numericId: string; gid: string;
  }>;
  rejectedShopifyCustomerCases: Array<{
    id: string; input: string | number; code: string;
  }>;
  shopifyScopeCases: Array<{
    id: string; shopA: string; shopB: string;
    customerA: string; customerB: string; equal: boolean;
  }>;
  recipientLifecycleCases: Array<{
    id: string; before: string; after: string;
    sameNumber: boolean; grantCarriesAcrossPrincipal: boolean;
  }>;
}

const fixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/identity-v1.json", import.meta.url), "utf8"),
) as IdentityFixtures;

test("portable identity fixture format is versioned and contains every required case", () => {
  assert.equal(fixtures.schemaVersion, 1);
  assert.ok(fixtures.phoneCases.length >= 10);
  assert.ok(fixtures.shopifyCustomerCases.length >= 3);
  assert.ok(fixtures.rejectedShopifyCustomerCases.length >= 5);
  assert.ok(fixtures.recipientLifecycleCases.some((c) => c.id === "number-rotated"));
  assert.ok(fixtures.recipientLifecycleCases.some((c) => c.id === "reassigned-to-other-person"));
});

for (const sample of fixtures.phoneCases) {
  test(`recipient golden fixture: ${sample.id}`, () => {
    const options = sample.verifiedCountryCode === null
      ? undefined
      : { verifiedCountryCode: sample.verifiedCountryCode };
    const result = normalizeRecipientPhone(sample.input, options);
    if (sample.reject) {
      assert.deepEqual(result, { ok: false, reason: sample.reject });
    } else {
      assert.deepEqual(result, { ok: true, e164: sample.e164 });
    }
  });
}

for (const sample of fixtures.shopifyCustomerCases) {
  test(`Shopify ID golden fixture: ${sample.id}`, () => {
    assert.deepEqual(parseShopifyCustomerIdentity(sample.input), {
      numericId: sample.numericId,
      gid: sample.gid,
    });
    assert.equal(isShopifyCustomerNumericId(sample.numericId), true);
    assert.equal(isShopifyCustomerNumericId(sample.gid), false);
  });
}

for (const sample of fixtures.rejectedShopifyCustomerCases) {
  test(`Shopify ID rejected fixture: ${sample.id}`, () => {
    assert.throws(() => parseShopifyCustomerIdentity(sample.input), (error: unknown) =>
      error instanceof ShopifyCustomerIdentityError && error.code === sample.code,
    );
    assert.equal(isShopifyCustomerNumericId(sample.input), false);
  });
}

for (const sample of fixtures.shopifyScopeCases) {
  test(`Shopify shop binding fixture: ${sample.id}`, () => {
    assert.equal(areSameShopifyCustomerWithinShop(
      { shopId: sample.shopA, customerId: sample.customerA },
      { shopId: sample.shopB, customerId: sample.customerB },
    ), sample.equal);
  });
}

for (const sample of fixtures.recipientLifecycleCases) {
  test(`recipient lifecycle fixture: ${sample.id}`, () => {
    const before = normalizeRecipientPhone(sample.before);
    const after = normalizeRecipientPhone(sample.after);
    assert.ok(before.ok);
    assert.ok(after.ok);
    if (!before.ok || !after.ok) return;
    assert.equal(before.e164 === after.e164, sample.sameNumber);
    assert.equal(sample.grantCarriesAcrossPrincipal, false);
  });
}

test("rejects unspecified, invalid and non-phone input without guessing", () => {
  assert.deepEqual(normalizeRecipientPhone(null), { ok: false, reason: "INVALID_FORMAT" });
  assert.deepEqual(normalizeRecipientPhone("+447700900123;ext=1"), {
    ok: false, reason: "EXTENSION_UNSUPPORTED",
  });
  assert.deepEqual(normalizeRecipientPhone("07400 123456", { verifiedCountryCode: "gb" }), {
    ok: false, reason: "UNSUPPORTED_COUNTRY",
  });
});
