import assert from "node:assert/strict";
import test from "node:test";
import {
  CredentialSecurityError,
  parseCredentialKeyring,
  resolveActiveCredentialKey,
} from "./node.js";
import { getCredentialKeyBytes } from "./keyring.js";

const firstKey = Buffer.alloc(32, 0x42).toString("base64");
const secondKey = Buffer.alloc(32, 0xac).toString("base64");
const asJson = (entries: Record<string, string>): string => JSON.stringify(entries);

function expectSecurityCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof CredentialSecurityError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes(firstKey), false);
    assert.equal(error.message.includes(secondKey), false);
    assert.equal(error.message.includes("COMMERCE_CONNECTION_"), false);
    return true;
  });
}

test("accepts a single canonical key and exposes no key material", () => {
  const keyring = parseCredentialKeyring(asJson({ "key-v1": firstKey }));
  assert.deepEqual(keyring.keyIds, ["key-v1"]);
  assert.equal(keyring.hasKey("key-v1"), true);
  assert.equal(keyring.hasKey("other"), false);
  assert.equal(resolveActiveCredentialKey(keyring, "key-v1"), "key-v1");
  assert.deepEqual(Object.keys(keyring).sort(), ["hasKey", "keyIds"]);
  assert.equal(JSON.stringify(keyring).includes(firstKey), false);
  assert.equal(Object.isFrozen(keyring), true);
  assert.equal(Object.isFrozen(keyring.keyIds), true);
});

test("accepts up to 16 keys, sorted regardless of input order", () => {
  const pairs = Array.from({ length: 16 }, (_, i) => [`key-${16 - i}`, firstKey]);
  const keyring = parseCredentialKeyring(JSON.stringify(Object.fromEntries(pairs)));
  assert.deepEqual(keyring.keyIds, Array.from({ length: 16 }, (_, i) => `key-${i + 1}`).sort());
  assert.equal(keyring.hasKey("key-16"), true);
});

test("reader-only parsing does not require an active key ID", () => {
  const keyring = parseCredentialKeyring(asJson({ first: firstKey, second: secondKey }));
  assert.deepEqual(keyring.keyIds, ["first", "second"]);
});

test("rejects malformed, non-object, empty or oversized JSON", () => {
  const malformed: Array<string | undefined> = [
    undefined, "", " ", "null", "true", "0", '"something"', "[]", "[1]", "{}",
    "{", '{"key":"value",}', '{"key":true}', '{"key":42}', '{"key":null}',
    '{"key":{}}', '{"key":[]}', '{"key":"value"} trailing',
    " ".repeat(4097) + asJson({ key: firstKey }),
    asJson(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, firstKey]))),
  ];
  for (const raw of malformed) {
    expectSecurityCode(() => parseCredentialKeyring(raw), "INVALID_KEYRING");
  }
});

test("rejects repeated decoded names including Unicode escape aliases", () => {
  const duplicates = [
    `{"key":"${firstKey}","key":"${secondKey}"}`,
    `{"key":"${firstKey}","k\\u0065y":"${secondKey}"}`,
    `{"\\u006Bey":"${firstKey}","key":"${secondKey}"}`,
  ];
  for (const raw of duplicates) {
    expectSecurityCode(() => parseCredentialKeyring(raw), "INVALID_KEYRING");
  }
});

test("rejects unsupported or reserved key identifiers", () => {
  for (const id of ["", "a space", "a.b", "a/b", "é", "a".repeat(65), "__proto__", "prototype", "constructor"]) {
    // JSON.stringify a plain object may special-case __proto__, so use an entries list.
    const raw = JSON.stringify(Object.fromEntries([[id, firstKey]]));
    expectSecurityCode(() => parseCredentialKeyring(raw), "INVALID_KEYRING");
  }
});

test("rejects noncanonical, wrong-sized or invalid Base64 key material", () => {
  const malformed = [
    "", "Zm9v", firstKey.slice(0, -1), firstKey.replace(/=/g, ""),
    Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"),
    firstKey.replace("Q", "-"), firstKey.replace("Q", "_"),
    ` ${firstKey}`, `${firstKey}\n`,
    // Change the low-order padding bits while preserving Base64 syntax.
    `${firstKey.slice(0, -2)}B=`,
  ];
  for (const encoded of malformed) {
    expectSecurityCode(() => parseCredentialKeyring(asJson({ test: encoded })), "INVALID_KEYRING");
  }
});

test("writer key selection requires an exact existing ID and never falls back", () => {
  const keyring = parseCredentialKeyring(asJson({ first: firstKey, second: secondKey }));
  for (const invalid of [undefined, "", " first", "first ", "missing", "constructor", "SECOND"]) {
    expectSecurityCode(() => resolveActiveCredentialKey(keyring, invalid), "KEY_UNAVAILABLE");
  }
  assert.equal(resolveActiveCredentialKey(keyring, "second"), "second");
  expectSecurityCode(() => resolveActiveCredentialKey({ keyIds: ["first"], hasKey: () => true }, "first"), "KEY_UNAVAILABLE");
});

test("public descriptor is frozen and internal key extraction is defensive", () => {
  const keyring = parseCredentialKeyring(asJson({ first: firstKey }));
  assert.throws(() => (keyring.keyIds as string[]).push("intruder"), TypeError);
  assert.throws(() => Object.defineProperty(keyring, "keyIds", { value: ["intruder"] }), TypeError);
  const extracted = getCredentialKeyBytes(keyring, "first");
  extracted.fill(0);
  assert.deepEqual(getCredentialKeyBytes(keyring, "first"), Uint8Array.from(Buffer.alloc(32, 0x42)));
  expectSecurityCode(() => getCredentialKeyBytes(keyring, "unknown"), "KEY_UNAVAILABLE");
  assert.equal("rawKeys" in keyring, false);
});

test("shared typed errors use stable static, non-sensitive messages", () => {
  for (const code of ["INVALID_KEYRING", "KEY_UNAVAILABLE", "INVALID_CREDENTIAL", "INVALID_COMMAND_HMAC_KEY"] as const) {
    const error = new CredentialSecurityError(code);
    assert.equal(error.name, "CredentialSecurityError");
    assert.equal(error.code, code);
    assert.ok(error.message.length > 0);
    assert.equal(error.cause, undefined);
  }
});
