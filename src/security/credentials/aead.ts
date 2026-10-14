import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { CredentialSecurityError } from "./errors.js";
import {
  getCredentialKeyBytes,
  resolveActiveCredentialKey,
  type CredentialKeyring,
} from "./keyring.js";

const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_CREDENTIAL_BYTES = 8192;
const MAX_AAD_BYTES = 4096;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_KEY_IDS = new Set(["__proto__", "prototype", "constructor"]);

/** Crypto envelope only; persistence and AAD construction belong to the caller. */
export type CredentialEnvelope = Readonly<{
  keyId: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}>;

function invalidCredential(): never {
  throw new CredentialSecurityError("INVALID_CREDENTIAL");
}

/** Reject UTF-16 strings that Node would otherwise encode with replacement bytes. */
function isValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 === value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function aadBytes(value: unknown): Buffer {
  let bytes: Buffer;
  if (typeof value === "string") {
    if (!isValidUnicode(value)) return invalidCredential();
    bytes = Buffer.from(value, "utf8");
  } else if (value instanceof Uint8Array) {
    // Copy the exact view, not its possibly larger underlying ArrayBuffer.
    bytes = Buffer.from(value);
  } else {
    return invalidCredential();
  }
  if (bytes.length < 1 || bytes.length > MAX_AAD_BYTES) return invalidCredential();
  return bytes;
}

function validEnvelope(value: unknown): value is CredentialEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<CredentialEnvelope>;
  return (
    typeof candidate.keyId === "string" &&
    KEY_ID_PATTERN.test(candidate.keyId) &&
    !RESERVED_KEY_IDS.has(candidate.keyId) &&
    candidate.nonce instanceof Uint8Array &&
    candidate.nonce.byteLength === NONCE_BYTES &&
    candidate.ciphertext instanceof Uint8Array &&
    candidate.ciphertext.byteLength >= 1 &&
    candidate.ciphertext.byteLength <= MAX_CREDENTIAL_BYTES &&
    candidate.authTag instanceof Uint8Array &&
    candidate.authTag.byteLength === AUTH_TAG_BYTES
  );
}

/** Keep native crypto and UTF-8 decoding exceptions out of the public error contract. */
function protectCredentialOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CredentialSecurityError) throw error;
    return invalidCredential();
  }
}

/** Encrypt a UTF-8 credential with caller-provided, mandatory authenticated data. */
export function encryptCredential(input: {
  keyring: CredentialKeyring;
  activeKeyId: string;
  plaintext: string;
  aad: string | Uint8Array;
}): CredentialEnvelope {
  return protectCredentialOperation(() => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return invalidCredential();
    const { keyring, activeKeyId, plaintext, aad } = input;
    if (typeof plaintext !== "string" || !isValidUnicode(plaintext)) return invalidCredential();
    const plaintextBytes = Buffer.from(plaintext, "utf8");
    if (plaintextBytes.length < 1 || plaintextBytes.length > MAX_CREDENTIAL_BYTES) {
      plaintextBytes.fill(0);
      return invalidCredential();
    }
    let key: Uint8Array | undefined;
    try {
      const authenticatedData = aadBytes(aad);
      const keyId = resolveActiveCredentialKey(keyring, activeKeyId);
      key = getCredentialKeyBytes(keyring, keyId);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: AUTH_TAG_BYTES });
      cipher.setAAD(authenticatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
      return Object.freeze({
        keyId,
        nonce: Uint8Array.from(nonce),
        ciphertext: Uint8Array.from(ciphertext),
        authTag: Uint8Array.from(cipher.getAuthTag()),
      });
    } finally {
      key?.fill(0);
      plaintextBytes.fill(0);
    }
  });
}

/** Decrypt only authenticated UTF-8 text; never return unauthenticated bytes. */
export function decryptCredential(input: {
  keyring: CredentialKeyring;
  envelope: CredentialEnvelope;
  aad: string | Uint8Array;
}): string {
  return protectCredentialOperation(() => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return invalidCredential();
    const { keyring, envelope, aad } = input;
    if (!validEnvelope(envelope)) return invalidCredential();
    const authenticatedData = aadBytes(aad);
    const key = getCredentialKeyBytes(keyring, envelope.keyId);
    let plaintextBytes: Buffer | undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce), {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(authenticatedData);
      decipher.setAuthTag(Buffer.from(envelope.authTag));
      plaintextBytes = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext)),
        decipher.final(),
      ]);
      // ignoreBOM preserves a leading U+FEFF so decrypt(encrypt(text)) is exact.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintextBytes);
    } finally {
      plaintextBytes?.fill(0);
      key.fill(0);
    }
  });
}
