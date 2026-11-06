import { Buffer } from "node:buffer";
import {
  decryptCredential,
  type CredentialEnvelope,
  type CredentialKeyring,
} from "../security/credentials/node.js";

const CONFIGURATION_KEY = "shopify.oauth" as const;
const CONFIGURATION_ENVIRONMENTS = new Set(["local", "test", "development", "staging", "production"]);
const ENVELOPE_KEYS = ["kind", "schemaVersion", "algorithm", "wrappingKeyId", "nonce", "ciphertext", "authTag"] as const;
const RESERVED_KEY_IDS = new Set(["__proto__", "prototype", "constructor"]);
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type ShopifyOAuthConfigurationErrorCode =
  | "INVALID_ENVIRONMENT"
  | "CONFIGURATION_UNAVAILABLE"
  | "CONFIGURATION_INVALID";

const ERROR_MESSAGES: Record<ShopifyOAuthConfigurationErrorCode, string> = {
  INVALID_ENVIRONMENT: "Shopify OAuth configuration is unavailable.",
  CONFIGURATION_UNAVAILABLE: "Shopify OAuth configuration is unavailable.",
  CONFIGURATION_INVALID: "Shopify OAuth configuration is invalid.",
};

/** Safe configuration boundary error; never contains a row, key, or decrypt cause. */
export class ShopifyOAuthConfigurationError extends Error {
  readonly code: ShopifyOAuthConfigurationErrorCode;

  constructor(code: ShopifyOAuthConfigurationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ShopifyOAuthConfigurationError";
    this.code = code;
  }
}

export type ShopifyOAuthConfigurationRow = Readonly<{
  environment: string;
  key: string;
  version: number;
  value: unknown;
}>;

export type ShopifyOAuthConfigurationPrisma = Readonly<{
  platformConfiguration: Readonly<{
    findUnique(args: Readonly<{
      where: Readonly<{ environment_key: Readonly<{ environment: string; key: typeof CONFIGURATION_KEY }> }>;
      select: Readonly<{ environment: true; key: true; version: true; value: true }>;
    }>): Promise<ShopifyOAuthConfigurationRow | null>;
  }>;
}>;

export type ShopifyOAuthCredentials = Readonly<{
  apiKey: string;
  apiSecret: string;
}>;

function configurationFailure(code: ShopifyOAuthConfigurationErrorCode): never {
  throw new ShopifyOAuthConfigurationError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function canonicalBase64(value: unknown, exactLength: number | null): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || !BASE64_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < 1 || decoded.length > 8192 || decoded.toString("base64") !== value) return null;
  if (exactLength !== null && decoded.length !== exactLength) return null;
  return Uint8Array.from(decoded);
}

function parseSealedEnvelope(value: unknown): CredentialEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)
    || value.kind !== "sealed"
    || value.schemaVersion !== 1
    || value.algorithm !== "AES-256-GCM"
    || typeof value.wrappingKeyId !== "string"
    || !KEY_ID_PATTERN.test(value.wrappingKeyId)
    || RESERVED_KEY_IDS.has(value.wrappingKeyId)) {
    return configurationFailure("CONFIGURATION_INVALID");
  }

  const nonce = canonicalBase64(value.nonce, 12);
  const ciphertext = canonicalBase64(value.ciphertext, null);
  const authTag = canonicalBase64(value.authTag, 16);
  if (!nonce || !ciphertext || !authTag) return configurationFailure("CONFIGURATION_INVALID");
  return { keyId: value.wrappingKeyId, nonce, ciphertext, authTag };
}

function validCredential(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096
    && value.trim() === value && !CONTROL_CHARACTERS.test(value);
}

function parseCredentials(value: unknown): ShopifyOAuthCredentials {
  if (!isRecord(value) || !hasExactKeys(value, ["apiKey", "apiSecret"])
    || !validCredential(value.apiKey) || !validCredential(value.apiSecret)) {
    return configurationFailure("CONFIGURATION_INVALID");
  }
  return Object.freeze({ apiKey: value.apiKey, apiSecret: value.apiSecret });
}

/**
 * Read and unseal the existing platform `shopify.oauth` row. Environment identity
 * is deployment configuration supplied by the caller, never request data.
 */
export async function readShopifyOAuthConfiguration(input: Readonly<{
  prisma: ShopifyOAuthConfigurationPrisma;
  environment: string;
  unsealKeyring: CredentialKeyring;
}>): Promise<ShopifyOAuthCredentials> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.environment !== "string" || !CONFIGURATION_ENVIRONMENTS.has(input.environment)) {
    return configurationFailure("INVALID_ENVIRONMENT");
  }

  let row: ShopifyOAuthConfigurationRow | null;
  try {
    row = await input.prisma.platformConfiguration.findUnique({
      where: { environment_key: { environment: input.environment, key: CONFIGURATION_KEY } },
      select: { environment: true, key: true, version: true, value: true },
    });
  } catch {
    return configurationFailure("CONFIGURATION_UNAVAILABLE");
  }

  if (!row) return configurationFailure("CONFIGURATION_UNAVAILABLE");
  if (row.environment !== input.environment || row.key !== CONFIGURATION_KEY
    || !Number.isSafeInteger(row.version) || row.version < 1 || row.version > 2_147_483_647) {
    return configurationFailure("CONFIGURATION_INVALID");
  }
  if (isRecord(row.value) && hasExactKeys(row.value, ["kind", "schemaVersion"])
    && row.value.kind === "disabled" && row.value.schemaVersion === 1) {
    return configurationFailure("CONFIGURATION_UNAVAILABLE");
  }

  let plaintext: string;
  try {
    const envelope = parseSealedEnvelope(row.value);
    const aad = JSON.stringify(["moda-platform-config-v1", input.environment, CONFIGURATION_KEY, row.version, 1]);
    plaintext = decryptCredential({ keyring: input.unsealKeyring, envelope, aad });
  } catch (error) {
    if (error instanceof ShopifyOAuthConfigurationError) throw error;
    return configurationFailure("CONFIGURATION_INVALID");
  }

  try {
    return parseCredentials(JSON.parse(plaintext) as unknown);
  } catch (error) {
    if (error instanceof ShopifyOAuthConfigurationError) throw error;
    return configurationFailure("CONFIGURATION_INVALID");
  }
}
