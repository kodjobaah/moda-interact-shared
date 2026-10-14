import { canonicalJson } from "../../commerce/canonical-json.js";
import {
  CommerceEnvironmentSchema,
  type CommerceEnvironment,
} from "../../commerce/model/index.js";
import { CredentialSecurityError } from "./errors.js";

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PURPOSES = new Set(["MERCHANT_KNOWLEDGE", "REFERENCE_TAXONOMY"]);
const FORBIDDEN_ID_CHARACTERS = /[\r\n\0]/;
const INVALID_UNICODE = /\p{Surrogate}/u;
const RESERVED_KEY_IDS = new Set(["__proto__", "prototype", "constructor"]);

type EmbeddingPurpose = "MERCHANT_KNOWLEDGE" | "REFERENCE_TAXONOMY";

export type CommerceEmbeddingCredentialAadInput = Readonly<{
  environment: CommerceEnvironment;
  purpose: EmbeddingPurpose;
  provider: string;
  keyId: string;
}>;

export type WooRestReadGrantAadInput = Readonly<{
  shopId: string;
  installationId: string;
  authorizationAttemptId: string;
  credentialVersionSnapshot: number;
}>;

function invalidAad(): never {
  // The message/code are constant: never interpolate merchant identifiers or secrets.
  throw new CredentialSecurityError("INVALID_CREDENTIAL");
}

function isBoundedIdentifier(value: unknown, limit: number): value is string {
  return typeof value === "string" &&
    value.length >= 1 && value.length <= limit &&
    value.trim().length > 0 &&
    !FORBIDDEN_ID_CHARACTERS.test(value) &&
    !INVALID_UNICODE.test(value);
}

/** Preserve the existing embedding canonical-JSON AAD bytes across writer/readers. */
export function createCommerceEmbeddingCredentialAad(
  input: CommerceEmbeddingCredentialAadInput,
): string {
  if (
    input === null || typeof input !== "object" ||
    !CommerceEnvironmentSchema.safeParse(input.environment).success ||
    !PURPOSES.has(input.purpose) ||
    !isBoundedIdentifier(input.provider, 128) ||
    typeof input.keyId !== "string" ||
    !KEY_ID_PATTERN.test(input.keyId) ||
    RESERVED_KEY_IDS.has(input.keyId)
  ) {
    return invalidAad();
  }

  return canonicalJson({
    credentialType: "EMBEDDING",
    environment: input.environment,
    purpose: input.purpose,
    provider: input.provider,
    keyId: input.keyId,
  });
}

/** Preserve the existing Woo API/Background JSON-array AAD bytes exactly. */
export function createWooRestReadGrantAad(input: WooRestReadGrantAadInput): string {
  if (
    input === null || typeof input !== "object" ||
    !isBoundedIdentifier(input.shopId, 128) ||
    !isBoundedIdentifier(input.installationId, 128) ||
    !isBoundedIdentifier(input.authorizationAttemptId, 128) ||
    !Number.isSafeInteger(input.credentialVersionSnapshot) ||
    input.credentialVersionSnapshot < 1
  ) {
    return invalidAad();
  }

  return JSON.stringify([
    "moda-woo-rest-read-v1",
    input.shopId,
    input.installationId,
    input.authorizationAttemptId,
    input.credentialVersionSnapshot,
  ]);
}
