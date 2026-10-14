import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { CredentialSecurityError } from "./errors.js";
import { getCredentialKeyBytes, type CredentialKeyring } from "./keyring.js";

const CANONICAL_BASE64_32_BYTE_KEY = /^[A-Za-z0-9+/]{43}=$/;

function invalidCommandHmacKey(): never {
  throw new CredentialSecurityError("INVALID_COMMAND_HMAC_KEY");
}

/**
 * Decode the Commerce connection-command HMAC secret, without accessing service
 * configuration or exposing AES key bytes. The caller supplies the configured
 * value and the canonical AES keyring explicitly.
 */
export function parseCommerceConnectionCommandHmacKey(
  raw: string | undefined,
  aesKeyring: CredentialKeyring,
): Uint8Array {
  if (typeof raw !== "string" || !CANONICAL_BASE64_32_BYTE_KEY.test(raw)) {
    return invalidCommandHmacKey();
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== raw) {
    return invalidCommandHmacKey();
  }

  // Examine *every* AES key, rather than returning on the first match. A
  // failed or forged keyring must never bypass the separation requirement.
  let reusesEncryptionKey = false;
  try {
    for (const keyId of aesKeyring.keyIds) {
      const aesBytes = getCredentialKeyBytes(aesKeyring, keyId);
      try {
        reusesEncryptionKey = timingSafeEqual(decoded, aesBytes) || reusesEncryptionKey;
      } finally {
        aesBytes.fill(0); // Only wipes the defensive copy, not the keyring.
      }
    }
    // The parser creates a nonempty keyring; reject invalid caller-supplied
    // substitutes rather than treating them as an empty, trusted keyring.
    if (aesKeyring.keyIds.length === 0) return invalidCommandHmacKey();
  } catch {
    return invalidCommandHmacKey();
  }

  if (reusesEncryptionKey) return invalidCommandHmacKey();
  return Uint8Array.from(decoded);
}
