/** A stable, secret-free error vocabulary shared by credential-security operations. */
export type CredentialSecurityErrorCode =
  | "INVALID_KEYRING"
  | "KEY_UNAVAILABLE"
  | "INVALID_CREDENTIAL"
  | "INVALID_COMMAND_HMAC_KEY";

const MESSAGES: Readonly<Record<CredentialSecurityErrorCode, string>> = {
  INVALID_KEYRING: "Invalid credential keyring configuration",
  KEY_UNAVAILABLE: "Credential encryption key is unavailable",
  INVALID_CREDENTIAL: "Invalid encrypted credential",
  INVALID_COMMAND_HMAC_KEY: "Invalid command authentication key",
};

export class CredentialSecurityError extends Error {
  readonly code: CredentialSecurityErrorCode;

  constructor(code: CredentialSecurityErrorCode) {
    super(MESSAGES[code]);
    this.name = "CredentialSecurityError";
    this.code = code;
  }
}
