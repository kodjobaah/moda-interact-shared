/** Node-only credential-security API. No environment or database access. */
export {
  parseCredentialKeyring,
  resolveActiveCredentialKey,
  type CredentialKeyring,
} from "./keyring.js";
export {
  CredentialSecurityError,
  type CredentialSecurityErrorCode,
} from "./errors.js";
