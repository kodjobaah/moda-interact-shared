/** Node-only credential-security API. No environment or database access. */
export {
  createCommerceEmbeddingCredentialAad,
  createWooRestReadGrantAad,
  type CommerceEmbeddingCredentialAadInput,
  type WooRestReadGrantAadInput,
} from "./aad.js";
export {
  parseCredentialKeyring,
  resolveActiveCredentialKey,
  type CredentialKeyring,
} from "./keyring.js";
export {
  CredentialSecurityError,
  type CredentialSecurityErrorCode,
} from "./errors.js";
export {
  encryptCredential,
  decryptCredential,
  type CredentialEnvelope,
} from "./aead.js";
