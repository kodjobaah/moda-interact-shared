import { z } from "zod";

const ISO_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const ISO_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const ISO_3166_ALPHA_2_CODES = new Set([
  "AF", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AX", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR", "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC", "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO", "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY", "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM", "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX", "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI", "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC", "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS", "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU", "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW",
]);
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export const LanguageSourceSchema = z.enum([
  "customer-explicit",
  "detected",
  "shopify",
  "merchant-default",
  "platform-default",
]);

export type LanguageSource = z.infer<typeof LanguageSourceSchema>;

function invalidValue(kind: string, value: string): TypeError {
  return new TypeError(`Invalid ${kind}: ${value}`);
}

export function canonicaliseLanguageTag(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidValue("BCP-47 language tag", value);
  }

  try {
    return new Intl.Locale(value.trim()).toString();
  } catch {
    throw invalidValue("BCP-47 language tag", value);
  }
}

export function normalizeCountryCode(value: string): string {
  if (typeof value !== "string") throw invalidValue("ISO 3166-1 alpha-2 country code", value);
  const code = value.trim().toUpperCase();
  if (!ISO_COUNTRY_CODE_PATTERN.test(code)) {
    throw invalidValue("ISO 3166-1 alpha-2 country code", value);
  }

  if (!ISO_3166_ALPHA_2_CODES.has(code)) {
    throw invalidValue("ISO 3166-1 alpha-2 country code", value);
  }

  return code;
}

export function normalizeCurrencyCode(value: string): string {
  if (typeof value !== "string") throw invalidValue("ISO 4217 currency code", value);
  const code = value.trim().toUpperCase();
  if (!ISO_CURRENCY_CODE_PATTERN.test(code) || !supportedCurrencies.has(code)) {
    throw invalidValue("ISO 4217 currency code", value);
  }
  return code;
}

export function normalizeTimeZone(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidValue("IANA time-zone identifier", value);
  }

  try {
    return new Intl.DateTimeFormat("en", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw invalidValue("IANA time-zone identifier", value);
  }
}

export const LanguageTagSchema = z.string().trim().transform(canonicaliseLanguageTag);
export const CountryCodeSchema = z.string().trim().transform(normalizeCountryCode);
export const CurrencyCodeSchema = z.string().trim().transform(normalizeCurrencyCode);
export const TimeZoneIdSchema = z.string().trim().transform(normalizeTimeZone);

export const InternationalContextSchema = z
  .object({
    languageTag: LanguageTagSchema.nullable(),
    languageSource: LanguageSourceSchema.nullable(),
    countryCode: CountryCodeSchema.nullable(),
    currencyCode: CurrencyCodeSchema.nullable(),
    timeZone: TimeZoneIdSchema.nullable(),
  })
  .strict();

export type LanguageTag = z.infer<typeof LanguageTagSchema>;
export type CountryCode = z.infer<typeof CountryCodeSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type TimeZoneId = z.infer<typeof TimeZoneIdSchema>;
export type InternationalContext = z.infer<typeof InternationalContextSchema>;

export function mergeInternationalContext(
  base: InternationalContext,
  override: InternationalContext,
): InternationalContext {
  return {
    languageTag: override.languageTag ?? base.languageTag,
    languageSource: override.languageSource ?? base.languageSource,
    countryCode: override.countryCode ?? base.countryCode,
    currencyCode: override.currencyCode ?? base.currencyCode,
    timeZone: override.timeZone ?? base.timeZone,
  };
}