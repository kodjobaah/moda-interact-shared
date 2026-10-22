import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";

export type RecipientPhoneRejection =
  | "INVALID_FORMAT"
  | "COUNTRY_REQUIRED"
  | "UNSUPPORTED_COUNTRY"
  | "COUNTRY_MISMATCH"
  | "EXTENSION_UNSUPPORTED"
  | "INVALID_NUMBER";

export type RecipientPhoneResult =
  | Readonly<{ ok: true; e164: string }>
  | Readonly<{ ok: false; reason: RecipientPhoneRejection }>;

/**
 * Canonical *number* identity only: it does not validate ownership,
 * WhatsApp reachability, local STOP, or any marketing consent.
 *
 * `verifiedCountryCode` must come from a trustworthy country source, not from
 * language/locale guesses. A national number without one always fails closed.
 * Provider wa_id/digits-only conversion belongs in service-specific adapters.
 */
export function normalizeRecipientPhone(
  input: unknown,
  context: { verifiedCountryCode?: string } = {},
): RecipientPhoneResult {
  if (typeof input !== "string" || input.length > 64) {
    return { ok: false, reason: "INVALID_FORMAT" };
  }

  const raw = input.trim();
  if (raw.length === 0) return { ok: false, reason: "INVALID_FORMAT" };
  // Reject letters, dial strings, extensions and characters other than normal
  // phone presentation punctuation. Do not silently remove an extension.
  if (/\b(?:ext\.?|extension|x)\s*\d/i.test(raw) || /[#;]/.test(raw)) {
    return { ok: false, reason: "EXTENSION_UNSUPPORTED" };
  }
  if (!/^\+?[0-9() .-]+$/.test(raw)) {
    return { ok: false, reason: "INVALID_FORMAT" };
  }

  const isInternational = raw.startsWith("+");
  const suppliedCountry = context.verifiedCountryCode;
  if (!isInternational && suppliedCountry === undefined) {
    return { ok: false, reason: "COUNTRY_REQUIRED" };
  }
  if (suppliedCountry !== undefined &&
      (!/^[A-Z]{2}$/.test(suppliedCountry) ||
       !isSupportedCountry(suppliedCountry as CountryCode))) {
    return { ok: false, reason: "UNSUPPORTED_COUNTRY" };
  }

  try {
    const phone = parsePhoneNumberFromString(raw, {
      ...(suppliedCountry ? { defaultCountry: suppliedCountry as CountryCode } : {}),
      extract: false,
    });
    if (!phone || !phone.isValid() || !/^\+[1-9][0-9]{1,14}$/.test(phone.number)) {
      return { ok: false, reason: "INVALID_NUMBER" };
    }
    if (phone.ext) return { ok: false, reason: "EXTENSION_UNSUPPORTED" };
    // With a verified context, an unrelated international number must not be
    // silently attributed to that country. The caller can omit the context
    // entirely when normalising an explicitly international number.
    if (suppliedCountry && phone.country !== suppliedCountry) {
      return { ok: false, reason: "COUNTRY_MISMATCH" };
    }
    return { ok: true, e164: phone.number };
  } catch {
    return { ok: false, reason: "INVALID_NUMBER" };
  }
}
