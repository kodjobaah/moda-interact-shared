import { Buffer } from "node:buffer";
import { CredentialSecurityError } from "./errors.js";

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const STANDARD_BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const RESERVED_KEY_IDS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_CONFIG_BYTES = 4096;
const MAX_KEYS = 16;
const KEY_BYTES = 32;

export interface CredentialKeyring {
  readonly keyIds: readonly string[];
  hasKey(keyId: string): boolean;
}

// The keyring descriptor never contains key material. In particular, consumers cannot
// obtain a reference to any retained secret through keyIds, hasKey, or object inspection.
const privateKeys = new WeakMap<CredentialKeyring, ReadonlyMap<string, Uint8Array>>();

function invalidKeyring(): never {
  throw new CredentialSecurityError("INVALID_KEYRING");
}

/**
 * Read a JSON string token, returning the decoded contents and the next offset.
 * JSON.parse validates escapes (including Unicode escapes) and rejects malformed text.
 * Only decoded property names are compared, preventing escaped duplicate aliases.
 */
function readJsonString(raw: string, start: number): [string, number] {
  if (raw[start] !== '"') invalidKeyring();
  let cursor = start + 1;
  while (cursor < raw.length) {
    const character = raw[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === '"') {
      const decoded: unknown = JSON.parse(raw.slice(start, cursor + 1));
      if (typeof decoded !== "string") invalidKeyring();
      return [decoded, cursor + 1];
    }
    cursor += 1;
  }
  return invalidKeyring();
}

/**
 * A small strict JSON-object scanner: the only supported format is a top-level
 * object mapping JSON string IDs to JSON string key values. Using JSON.parse(raw)
 * alone would silently discard duplicate property names, which we must reject.
 */
function parseUniqueStringObject(raw: string): Map<string, string> {
  // Validate the complete JSON grammar, including escape sequences and trailing data.
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return invalidKeyring();
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return invalidKeyring();
  }

  let index = 0;
  const skipWhitespace = (): void => {
    while (index < raw.length && /[ \t\r\n]/.test(raw[index]!)) index += 1;
  };

  const entries = new Map<string, string>();
  skipWhitespace();
  if (raw[index++] !== "{") return invalidKeyring();
  skipWhitespace();
  if (raw[index] === "}") return invalidKeyring();

  while (index < raw.length) {
    const [key, afterKey] = readJsonString(raw, index);
    if (entries.has(key)) return invalidKeyring();
    if (!KEY_ID_PATTERN.test(key) || RESERVED_KEY_IDS.has(key)) return invalidKeyring();
    index = afterKey;
    skipWhitespace();
    if (raw[index++] !== ":") return invalidKeyring();
    skipWhitespace();
    const [value, afterValue] = readJsonString(raw, index);
    entries.set(key, value);
    if (entries.size > MAX_KEYS) return invalidKeyring();
    index = afterValue;
    skipWhitespace();
    const separator = raw[index++];
    if (separator === "}") break;
    if (separator !== ",") return invalidKeyring();
    skipWhitespace();
  }
  skipWhitespace();
  if (index !== raw.length || entries.size === 0) return invalidKeyring();
  return entries;
}

/** Validate and retain canonical 32-byte AES key material without exposing the bytes. */
export function parseCredentialKeyring(raw: string | undefined): CredentialKeyring {
  if (typeof raw !== "string" || raw.trim().length === 0 || Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    return invalidKeyring();
  }

  let entries: Map<string, string>;
  try {
    entries = parseUniqueStringObject(raw);
  } catch {
    // No native JSON parsing error or untrusted data may escape this boundary.
    return invalidKeyring();
  }

  const keys = new Map<string, Uint8Array>();
  for (const [keyId, encoded] of entries) {
    if (!STANDARD_BASE64_KEY_PATTERN.test(encoded)) return invalidKeyring();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== KEY_BYTES || bytes.toString("base64") !== encoded) {
      return invalidKeyring();
    }
    keys.set(keyId, Uint8Array.from(bytes));
  }

  const keyIds = Object.freeze([...keys.keys()].sort());
  const descriptor: CredentialKeyring = Object.freeze({
    keyIds,
    hasKey: (keyId: string): boolean => typeof keyId === "string" && keys.has(keyId),
  });
  privateKeys.set(descriptor, keys);
  return descriptor;
}

/** An explicit writer selection; never select the first key or trim an input. */
export function resolveActiveCredentialKey(
  keyring: CredentialKeyring,
  activeKeyId: string | undefined,
): string {
  const keys = privateKeys.get(keyring);
  if (
    !keys ||
    typeof activeKeyId !== "string" ||
    !KEY_ID_PATTERN.test(activeKeyId) ||
    RESERVED_KEY_IDS.has(activeKeyId) ||
    !keys.has(activeKeyId)
  ) {
    throw new CredentialSecurityError("KEY_UNAVAILABLE");
  }
  return activeKeyId;
}

/**
 * Package-internal helper for SHARED-002. Never re-export from the public Node
 * entrypoint. Return a defensive copy so an AEAD consumer cannot mutate the
 * retained key material (including after an encryption failure).
 */
export function getCredentialKeyBytes(keyring: CredentialKeyring, keyId: string): Uint8Array {
  const bytes = privateKeys.get(keyring)?.get(keyId);
  if (!bytes) throw new CredentialSecurityError("KEY_UNAVAILABLE");
  return Uint8Array.from(bytes);
}
