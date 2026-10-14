import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  CredentialSecurityError,
  parseCommerceConnectionCommandHmacKey,
  parseCredentialKeyring,
} from "./node.js";
import type { CredentialKeyring } from "./keyring.js";

const aesKey1 = Buffer.alloc(32, 0x42);
const aesKey2 = Buffer.alloc(32, 0xac);
const hmacBytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const hmacBase64 = hmacBytes.toString("base64");
const aesKeyring = parseCredentialKeyring(JSON.stringify({
  "aes-1": aesKey1.toString("base64"),
  "aes-2": aesKey2.toString("base64"),
}));

function assertInvalid(raw: unknown, keyring: CredentialKeyring = aesKeyring): void {
  assert.throws(
    () => parseCommerceConnectionCommandHmacKey(raw as string | undefined, keyring),
    (error: unknown) => {
      assert.ok(error instanceof CredentialSecurityError);
      assert.equal(error.code, "INVALID_COMMAND_HMAC_KEY");
      assert.equal(error.message, "Invalid command authentication key");
      assert.equal(error.cause, undefined);
      for (const secret of [hmacBase64, aesKey1.toString("base64"), aesKey2.toString("base64")]) {
        assert.equal(error.message.includes(secret), false);
      }
      return true;
    },
  );
}

test("decodes a canonical padded Base64 HMAC secret to independent 32-byte data", () => {
  const result = parseCommerceConnectionCommandHmacKey(hmacBase64, aesKeyring);
  assert.ok(result instanceof Uint8Array);
  assert.equal(result.length, 32);
  assert.deepEqual(result, Uint8Array.from(hmacBytes));
  assert.notEqual(result, hmacBytes);
  assert.notEqual(Buffer.from(result).toString("utf8"), hmacBase64);
});

test("known HMAC-SHA256 vector uses decoded bytes, not the Base64 string", () => {
  const key = parseCommerceConnectionCommandHmacKey(hmacBase64, aesKeyring);
  const message = "moda-interact-commerce-command-v1";
  const digest = createHmac("sha256", key).update(message).digest("hex");
  assert.equal(digest, "57926584e7abfdcd6a89b42c983bc0f55cc0e567319d02d6a3d74ccaafa02cb1");
  assert.notEqual(digest, createHmac("sha256", hmacBase64).update(message).digest("hex"));
});

test("rejects missing, blank, non-string, padded incorrectly and whitespace values", () => {
  for (const value of [
    undefined, "", " ", null, 123, {}, [],
    `${hmacBase64} `, ` ${hmacBase64}`, `${hmacBase64}\n`,
    hmacBase64.slice(0, -1), `${hmacBase64}=`,
  ]) {
    assertInvalid(value);
  }
});

test("rejects base64url and other alternative encoding", () => {
  const urlDistinguishingKey = Buffer.alloc(32, 0xfb).toString("base64");
  assert.ok(urlDistinguishingKey.includes("+"));
  assertInvalid(urlDistinguishingKey.replaceAll("+", "-"));
  assertInvalid(Buffer.from(hmacBytes).toString("hex"));
  assertInvalid(Buffer.from(hmacBytes).toString("base64url"));
});

test("rejects 31- and 33-byte encoded keys", () => {
  for (const size of [0, 1, 31, 33, 64]) {
    assertInvalid(Buffer.alloc(size, 0x55).toString("base64"));
  }
});

test("rejects noncanonical padding bits even for a matching 32-byte result", () => {
  assert.ok(hmacBase64.endsWith("="));
  // A different final Base64 symbol can decode to identical 32 bytes if its
  // unused padding bits are nonzero. Round-trip equality must catch this.
  const malformed = `${hmacBase64.slice(0, -2)}9=`;
  assert.notEqual(malformed, hmacBase64);
  assert.deepEqual(Buffer.from(malformed, "base64"), hmacBytes);
  assertInvalid(malformed);
});

test("rejects HMAC material matching the first AES key", () => {
  assertInvalid(aesKey1.toString("base64"));
});

test("rejects HMAC material matching a later AES key", () => {
  assertInvalid(aesKey2.toString("base64"));
});

test("rejects a forged or invalid keyring instead of bypassing AES key separation", () => {
  assertInvalid(hmacBase64, { keyIds: [], hasKey: () => false });
  assertInvalid(hmacBase64, { keyIds: ["aes-1"], hasKey: () => true });
  assertInvalid(hmacBase64, null as unknown as CredentialKeyring);
});

test("returned HMAC key is independent of caller input and AES ring", () => {
  const bytes = parseCommerceConnectionCommandHmacKey(hmacBase64, aesKeyring);
  bytes.fill(0);
  assert.deepEqual(parseCommerceConnectionCommandHmacKey(hmacBase64, aesKeyring), Uint8Array.from(hmacBytes));
  assert.deepEqual(aesKeyring.keyIds, ["aes-1", "aes-2"]);
});
