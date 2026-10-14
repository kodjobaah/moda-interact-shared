import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import {
  CredentialSecurityError,
  decryptCredential,
  encryptCredential,
  parseCredentialKeyring,
  type CredentialEnvelope,
} from "./node.js";

const FIRST_BYTES = Buffer.alloc(32, 0x23);
const SECOND_BYTES = Buffer.alloc(32, 0x71);
const keyring = parseCredentialKeyring(JSON.stringify({
  "key-1": FIRST_BYTES.toString("base64"),
  "key-2": SECOND_BYTES.toString("base64"),
}));
const aad = "moda:tenant-1:credential-v1";

function encrypt(plaintext: string, inputAad: string | Uint8Array = aad) {
  return encryptCredential({ keyring, activeKeyId: "key-1", plaintext, aad: inputAad });
}
function decrypt(envelope: CredentialEnvelope, inputAad: string | Uint8Array = aad) {
  return decryptCredential({ keyring, envelope, aad: inputAad });
}
function expectCode(operation: () => unknown, code: "INVALID_CREDENTIAL" | "KEY_UNAVAILABLE") {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof CredentialSecurityError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    assert.ok(!error.message.includes(aad));
    assert.ok(!error.message.includes("highly-secret"));
    assert.ok(!error.message.includes(FIRST_BYTES.toString("base64")));
    return true;
  });
}
function modified(envelope: CredentialEnvelope, field: "nonce" | "ciphertext" | "authTag") {
  const value = Uint8Array.from(envelope[field]);
  value[0] ^= 0x01;
  return { ...envelope, [field]: value };
}

// These are independent Node crypto reference implementations; neither invokes Shared.
function referenceDecrypt(envelope: CredentialEnvelope, inputAad: string | Uint8Array): string {
  const decipher = createDecipheriv("aes-256-gcm", FIRST_BYTES, envelope.nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(inputAad));
  decipher.setAuthTag(Buffer.from(envelope.authTag));
  return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8");
}
function referenceEncrypt(plaintext: Uint8Array, inputAad: string | Uint8Array, keyId = "key-1") {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", FIRST_BYTES, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(inputAad));
  return {
    keyId,
    nonce: Uint8Array.from(nonce),
    ciphertext: Uint8Array.from(Buffer.concat([cipher.update(plaintext), cipher.final()])),
    authTag: Uint8Array.from(cipher.getAuthTag()),
  };
}

test("one canonical text API round-trips ASCII, multibyte Unicode and BOM exactly", () => {
  for (const plaintext of ["highly-secret", "🔐 漢字 café", "\ufeffleading BOM", "x".repeat(8192), "😀".repeat(2048)]) {
    const sealed = encrypt(plaintext);
    assert.equal(sealed.keyId, "key-1");
    assert.equal(sealed.nonce.byteLength, 12);
    assert.equal(sealed.authTag.byteLength, 16);
    assert.equal(sealed.ciphertext.byteLength, Buffer.byteLength(plaintext, "utf8"));
    assert.equal(decrypt(sealed), plaintext);
  }
});

test("fresh nonce for every encryption and no fixed/deterministic output", () => {
  const nonces = new Set<string>();
  for (let i = 0; i < 24; i += 1) {
    const envelope = encrypt("highly-secret");
    const nonce = Buffer.from(envelope.nonce).toString("hex");
    assert.equal(nonces.has(nonce), false);
    nonces.add(nonce);
  }
  assert.equal(nonces.size, 24);
});

test("strict plaintext bounds use UTF-8 byte length and reject malformed Unicode", () => {
  for (const plaintext of ["", "x".repeat(8193), "😀".repeat(2049), "\ud800", "\udc00", "a\ud800b", "\ud800\ud800", "\udc00\udc00"]) {
    expectCode(() => encrypt(plaintext), "INVALID_CREDENTIAL");
  }
  expectCode(() => encryptCredential({ keyring, activeKeyId: "key-1", plaintext: Buffer.from("x") as unknown as string, aad }), "INVALID_CREDENTIAL");
  expectCode(() => encryptCredential({ keyring, activeKeyId: "key-1", plaintext: undefined as unknown as string, aad }), "INVALID_CREDENTIAL");
  assert.equal(decrypt(encrypt("é".repeat(4096))), "é".repeat(4096));
});

test("AAD is required, bounded, authenticates exact bytes and respects typed-array views", () => {
  for (const bad of ["", "x".repeat(4097), "\ud800", new Uint8Array(), new Uint8Array(4097), null, undefined, 12, [1, 2], new DataView(new ArrayBuffer(2))]) {
    expectCode(() => encryptCredential({ keyring, activeKeyId: "key-1", plaintext: "x", aad: bad as string }), "INVALID_CREDENTIAL");
    expectCode(() => decryptCredential({ keyring, envelope: encrypt("x"), aad: bad as string }), "INVALID_CREDENTIAL");
  }
  const backing = Uint8Array.from([99, 1, 2, 3, 88]);
  const view = backing.subarray(1, 4);
  const sealed = encrypt("highly-secret", view);
  assert.equal(decrypt(sealed, Uint8Array.from([1, 2, 3])), "highly-secret");
  assert.deepEqual(backing, Uint8Array.from([99, 1, 2, 3, 88]));
  expectCode(() => decrypt(sealed, Uint8Array.from([1, 2, 4])), "INVALID_CREDENTIAL");
  assert.equal(decrypt(encrypt("x", "a".repeat(4096)), "a".repeat(4096)), "x");
});

test("a changed active ID can still decrypt older ciphertext by envelope ID", () => {
  const first = encrypt("highly-secret");
  const second = encryptCredential({ keyring, activeKeyId: "key-2", plaintext: "new credential", aad });
  assert.equal(decrypt(first), "highly-secret");
  assert.equal(decrypt(second), "new credential");
  assert.equal(second.keyId, "key-2");
  expectCode(() => encryptCredential({ keyring, activeKeyId: "missing", plaintext: "x", aad }), "KEY_UNAVAILABLE");
  expectCode(() => encryptCredential({ keyring, activeKeyId: "", plaintext: "x", aad }), "KEY_UNAVAILABLE");
  expectCode(() => encryptCredential({ keyring, activeKeyId: undefined as unknown as string, plaintext: "x", aad }), "KEY_UNAVAILABLE");
  expectCode(() => decrypt({ ...first, keyId: "missing" }), "KEY_UNAVAILABLE");
  expectCode(() => decrypt({ ...first, keyId: "key-2" }), "INVALID_CREDENTIAL");
});

test("ciphertext, nonce, tag and AAD tampering always fail closed", () => {
  const sealed = encrypt("highly-secret");
  for (const field of ["nonce", "ciphertext", "authTag"] as const) {
    const changed = modified(sealed, field);
    const bytesBefore = Uint8Array.from(changed[field]);
    expectCode(() => decrypt(changed), "INVALID_CREDENTIAL");
    assert.deepEqual(changed[field], bytesBefore);
  }
  expectCode(() => decrypt(sealed, aad + ":different"), "INVALID_CREDENTIAL");
  assert.equal(decrypt(sealed), "highly-secret");
});

test("internal envelope validation rejects invalid shapes, fields, lengths and key identifiers", () => {
  const sealed = encrypt("x");
  const badEnvelopes: unknown[] = [
    undefined, null, "encrypted", [], 12, {},
    { ...sealed, keyId: "" },
    { ...sealed, keyId: "space id" },
    { ...sealed, keyId: "__proto__" },
    { ...sealed, keyId: "x".repeat(65) },
    { ...sealed, keyId: null },
    { ...sealed, nonce: new Uint8Array(11) },
    { ...sealed, nonce: new Uint8Array(13) },
    { ...sealed, nonce: new ArrayBuffer(12) },
    { ...sealed, nonce: Array.from(sealed.nonce) },
    { ...sealed, ciphertext: new Uint8Array(0) },
    { ...sealed, ciphertext: new Uint8Array(8193) },
    { ...sealed, ciphertext: new DataView(new ArrayBuffer(1)) },
    { ...sealed, authTag: new Uint8Array(15) },
    { ...sealed, authTag: new Uint8Array(17) },
    { ...sealed, authTag: "1234567890123456" },
    { ...sealed, authTag: null },
  ];
  for (const envelope of badEnvelopes) {
    expectCode(() => decryptCredential({ keyring, envelope: envelope as CredentialEnvelope, aad }), "INVALID_CREDENTIAL");
  }
  const hostile = { ...sealed, get nonce() { throw new Error("private value leaked"); } };
  expectCode(() => decryptCredential({ keyring, envelope: hostile as unknown as CredentialEnvelope, aad }), "INVALID_CREDENTIAL");
  expectCode(() => decryptCredential(null as unknown as Parameters<typeof decryptCredential>[0]), "INVALID_CREDENTIAL");
  expectCode(() => encryptCredential(null as unknown as Parameters<typeof encryptCredential>[0]), "INVALID_CREDENTIAL");
});

test("reference Node crypto decrypts Shared's envelope with the same AAD", () => {
  for (const plaintext of ["highly-secret", "🛍️ tienda café"]) {
    const sealed = encrypt(plaintext);
    assert.equal(referenceDecrypt(sealed, aad), plaintext);
  }
});

test("Shared decrypts independent Node AES-256-GCM reference ciphertext", () => {
  const bytes = Buffer.from("highly-secret\n🔐", "utf8");
  const sealed = referenceEncrypt(bytes, aad);
  assert.equal(decrypt(sealed), "highly-secret\n🔐");
  expectCode(() => decrypt(sealed, "wrong AAD"), "INVALID_CREDENTIAL");
});

test("authenticated non-UTF8 plaintext cannot escape as lossy text", () => {
  for (const bytes of [Uint8Array.from([0xc3, 0x28]), Uint8Array.from([0xff]), Uint8Array.from([0xef, 0xbb])]) {
    const sealed = referenceEncrypt(bytes, aad);
    expectCode(() => decrypt(sealed), "INVALID_CREDENTIAL");
  }
});

test("supplied nonce/ciphertext/tag and AAD buffers are never mutated", () => {
  const sealed = referenceEncrypt(Buffer.from("highly-secret"), aad);
  const snapshot = Object.fromEntries(
    (["nonce", "ciphertext", "authTag"] as const).map((field) => [field, Uint8Array.from(sealed[field])]),
  );
  const aadView = Uint8Array.from(Buffer.from(aad));
  const aadOriginal = Uint8Array.from(aadView);
  assert.equal(decrypt(sealed, aadView), "highly-secret");
  assert.deepEqual(aadView, aadOriginal);
  for (const field of ["nonce", "ciphertext", "authTag"] as const) {
    assert.deepEqual(sealed[field], snapshot[field]);
  }
  const output = encrypt("highly-secret", aadView);
  assert.equal(decrypt(output, aadView), "highly-secret");
  assert.deepEqual(aadView, aadOriginal);
});
