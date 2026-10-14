import assert from "node:assert/strict";
import test from "node:test";

import { CredentialSecurityError } from "./errors.js";
import {
  createCommerceEmbeddingCredentialAad,
  createWooRestReadGrantAad,
  type CommerceEmbeddingCredentialAadInput,
  type WooRestReadGrantAadInput,
} from "./aad.js";

const embedding: CommerceEmbeddingCredentialAadInput = {
  environment: "PRODUCTION",
  purpose: "MERCHANT_KNOWLEDGE",
  provider: "openai",
  keyId: "embed_v1",
};
const woo: WooRestReadGrantAadInput = {
  shopId: "shop-1",
  installationId: "installation-2",
  authorizationAttemptId: "attempt-3",
  credentialVersionSnapshot: 4,
};

function invalid(value: () => unknown): void {
  assert.throws(value, (error: unknown) => {
    assert.ok(error instanceof CredentialSecurityError);
    assert.equal(error.code, "INVALID_CREDENTIAL");
    assert.equal(error.message, "Invalid encrypted credential");
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("embedding AAD golden bytes: merchant knowledge / production", () => {
  // Independently fixed against the old Admin createEmbeddingCredentialAad.
  const expected = '{"credentialType":"EMBEDDING","environment":"PRODUCTION","keyId":"embed_v1","provider":"openai","purpose":"MERCHANT_KNOWLEDGE"}';
  const actual = createCommerceEmbeddingCredentialAad(embedding);
  assert.deepEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
});

test("embedding AAD golden bytes: reference taxonomy / test", () => {
  // Independently fixed against the existing Admin/Commerce/MCP canonicalJson object.
  const expected = '{"credentialType":"EMBEDDING","environment":"TEST","keyId":"k-2","provider":"vector-β","purpose":"REFERENCE_TAXONOMY"}';
  const actual = createCommerceEmbeddingCredentialAad({
    environment: "TEST", purpose: "REFERENCE_TAXONOMY", provider: "vector-β", keyId: "k-2",
  });
  assert.deepEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
});

test("Woo grant AAD golden bytes: fixed API/Background array format", () => {
  const expected = '["moda-woo-rest-read-v1","shop-1","installation-2","attempt-3",4]';
  assert.deepEqual(Buffer.from(createWooRestReadGrantAad(woo), "utf8"), Buffer.from(expected, "utf8"));
});

test("Woo grant AAD golden bytes: Unicode and escaped quote", () => {
  const expected = '["moda-woo-rest-read-v1","shop-α","install\\\"2","attempt-4",1]';
  assert.deepEqual(
    Buffer.from(createWooRestReadGrantAad({
      shopId: "shop-α", installationId: 'install"2',
      authorizationAttemptId: "attempt-4", credentialVersionSnapshot: 1,
    }), "utf8"),
    Buffer.from(expected, "utf8"),
  );
});

test("every embedding identity field changes the authenticated bytes", () => {
  const expected = createCommerceEmbeddingCredentialAad(embedding);
  const different: CommerceEmbeddingCredentialAadInput[] = [
    { ...embedding, environment: "STAGING" },
    { ...embedding, purpose: "REFERENCE_TAXONOMY" },
    { ...embedding, provider: "another-provider" },
    { ...embedding, keyId: "embed_v2" },
  ];
  for (const context of different) {
    assert.notEqual(createCommerceEmbeddingCredentialAad(context), expected);
  }
});

test("every Woo grant identity field and snapshot changes authenticated bytes", () => {
  const expected = createWooRestReadGrantAad(woo);
  const different: WooRestReadGrantAadInput[] = [
    { ...woo, shopId: "shop-2" },
    { ...woo, installationId: "installation-3" },
    { ...woo, authorizationAttemptId: "attempt-4" },
    { ...woo, credentialVersionSnapshot: 5 },
  ];
  for (const context of different) assert.notEqual(createWooRestReadGrantAad(context), expected);
});

test("embedding rejects malformed identities, enum values and untrusted runtime inputs", () => {
  const malformed: unknown[] = [
    null,
    {},
    { ...embedding, environment: "LIVE" },
    { ...embedding, purpose: "OTHER" },
    { ...embedding, provider: "" },
    { ...embedding, provider: "   " },
    { ...embedding, provider: "p".repeat(129) },
    { ...embedding, provider: "p\nsecret" },
    { ...embedding, provider: "p\rsecret" },
    { ...embedding, provider: "p\0secret" },
    { ...embedding, provider: "p\ud800" },
    { ...embedding, provider: 42 },
    { ...embedding, keyId: "" },
    { ...embedding, keyId: "a".repeat(65) },
    { ...embedding, keyId: "bad key" },
    { ...embedding, keyId: "__proto__" },
    { ...embedding, keyId: null },
  ];
  for (const input of malformed) {
    invalid(() => createCommerceEmbeddingCredentialAad(input as CommerceEmbeddingCredentialAadInput));
  }
});

test("Woo grant rejects invalid identifiers, versions and runtime inputs", () => {
  const malformed: unknown[] = [
    null,
    {},
    { ...woo, shopId: "" },
    { ...woo, shopId: " " },
    { ...woo, shopId: "x".repeat(129) },
    { ...woo, shopId: "x\runsafe" },
    { ...woo, installationId: "" },
    { ...woo, installationId: "x\0unsafe" },
    { ...woo, authorizationAttemptId: "" },
    { ...woo, authorizationAttemptId: "x\nunsafe" },
    { ...woo, authorizationAttemptId: "x\ud800" },
    { ...woo, credentialVersionSnapshot: 0 },
    { ...woo, credentialVersionSnapshot: -1 },
    { ...woo, credentialVersionSnapshot: 2.5 },
    { ...woo, credentialVersionSnapshot: Number.MAX_SAFE_INTEGER + 1 },
    { ...woo, credentialVersionSnapshot: "4" },
    { ...woo, credentialVersionSnapshot: Number.NaN },
  ];
  for (const input of malformed) {
    invalid(() => createWooRestReadGrantAad(input as WooRestReadGrantAadInput));
  }
});

test("AAD preserves valid IDs without normalising their source bytes", () => {
  assert.notEqual(
    createCommerceEmbeddingCredentialAad({ ...embedding, provider: "Provider" }),
    createCommerceEmbeddingCredentialAad({ ...embedding, provider: "provider" }),
  );
  assert.notEqual(
    createWooRestReadGrantAad({ ...woo, shopId: "shop-1" }),
    createWooRestReadGrantAad({ ...woo, shopId: "Shop-1" }),
  );
});
