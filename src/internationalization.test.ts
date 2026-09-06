import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicaliseLanguageTag,
  CountryCodeSchema,
  CurrencyCodeSchema,
  InternationalContextSchema,
  mergeInternationalContext,
  normalizeCountryCode,
  normalizeCurrencyCode,
  normalizeTimeZone,
  createInternationalizationRuntime,
  resolveLocaleDirection,
  validateIcuCatalogue,
  TimeZoneIdSchema,
} from "./internationalization.js";

test("canonicalises valid BCP-47 language tags without an application allowlist", () => {
  assert.equal(canonicaliseLanguageTag("pt-br"), "pt-BR");
  assert.equal(canonicaliseLanguageTag("ar"), "ar");
  assert.equal(canonicaliseLanguageTag("zh-Hant-TW"), "zh-Hant-TW");
  assert.throws(() => canonicaliseLanguageTag("not a language"));
});

test("normalises independent country and currency standards", () => {
  for (const countryCode of ["GB", "BR", "FR", "CH"]) {
    assert.equal(normalizeCountryCode(countryCode), countryCode);
  }
  assert.equal(normalizeCountryCode("gb"), "GB");
  assert.equal(normalizeCountryCode("br"), "BR");
  assert.equal(normalizeCountryCode("AX"), "AX");
  assert.equal(normalizeCurrencyCode("gbp"), "GBP");
  assert.equal(normalizeCurrencyCode("eur"), "EUR");
  for (const countryCode of ["ZZ", "EU", "UN", "EZ", "XA", "XB", "QO", "UK", "XK"]) {
    assert.throws(() => normalizeCountryCode(countryCode));
  }
  assert.throws(() => normalizeCurrencyCode("US"));
});

test("normalises IANA time-zone identifiers", () => {
  assert.equal(normalizeTimeZone("Europe/London"), "Europe/London");
  assert.equal(normalizeTimeZone("UTC"), "UTC");
  assert.throws(() => normalizeTimeZone("not/a-time-zone"));
});

test("validates nullable international context without inferring fields", () => {
  const context = InternationalContextSchema.parse({
    languageTag: "fr-FR",
    languageSource: "shopify",
    countryCode: "CH",
    currencyCode: "CHF",
    timeZone: "Europe/Zurich",
  });

  assert.equal(context.languageTag, "fr-FR");
  assert.equal(context.countryCode, "CH");
  assert.equal(context.currencyCode, "CHF");
  assert.deepEqual(InternationalContextSchema.parse({
    languageTag: null,
    languageSource: null,
    countryCode: "GB",
    currencyCode: "GBP",
    timeZone: null,
  }), {
    languageTag: null,
    languageSource: null,
    countryCode: "GB",
    currencyCode: "GBP",
    timeZone: null,
  });
  assert.doesNotThrow(() => InternationalContextSchema.parse({
    languageTag: "en-GB",
    languageSource: "shopify",
    countryCode: "CH",
    currencyCode: "EUR",
    timeZone: "Europe/Zurich",
  }));
  assert.throws(() => InternationalContextSchema.parse({
    languageTag: "en-GB",
    languageSource: "shopify",
    countryCode: "GB",
    currencyCode: "GBP",
    timeZone: "Europe/London",
    providerLanguageCode: "en_US",
  }));
});

test("merges only supplied context fields with explicit override precedence", () => {
  const base = InternationalContextSchema.parse({
    languageTag: "en-GB",
    languageSource: "merchant-default",
    countryCode: "GB",
    currencyCode: "GBP",
    timeZone: "Europe/London",
  });
  const override = InternationalContextSchema.parse({
    languageTag: "pl-PL",
    languageSource: "customer-explicit",
    countryCode: null,
    currencyCode: null,
    timeZone: null,
  });

  assert.deepEqual(mergeInternationalContext(base, override), {
    languageTag: "pl-PL",
    languageSource: "customer-explicit",
    countryCode: "GB",
    currencyCode: "GBP",
    timeZone: "Europe/London",
  });
});

test("exports canonical code schemas for direct consumer validation", () => {
  assert.equal(CountryCodeSchema.parse("fr"), "FR");
  assert.equal(CurrencyCodeSchema.parse("brl"), "BRL");
  assert.equal(TimeZoneIdSchema.parse("America/Sao_Paulo"), "America/Sao_Paulo");
});

test("formats ICU interpolation, plural, select, and ordinal messages", () => {
  const runtime = createInternationalizationRuntime({
    locale: "en-GB",
    catalogue: {
      greeting: "Hello, {name}!",
      items: "{count, plural, =0 {No items} one {# item} other {# items}}",
      role: "{gender, select, female {She} male {He} other {They}} selected this.",
      rank: "You came {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}.",
    },
  });

  assert.equal(runtime.t("greeting", { name: "Ada" }), "Hello, Ada!");
  assert.equal(runtime.t("items", { count: 2 }), "2 items");
  assert.equal(runtime.t("items", { count: 1 }), "1 item");
  assert.equal(runtime.t("role", { gender: "female" }), "She selected this.");
  assert.equal(runtime.t("rank", { place: 3 }), "You came 3rd.");
});

test("uses CLDR Czech one, few, and other plural categories", () => {
  const runtime = createInternationalizationRuntime({
    locale: "cs-CZ",
    catalogue: {
      items: "{count, plural, one {# položka} few {# položky} other {# položek}}",
    },
  });

  assert.equal(runtime.t("items", { count: 1 }), "1 položka");
  assert.equal(runtime.t("items", { count: 3 }), "3 položky");
  assert.equal(runtime.t("items", { count: 5 }), "5 položek");
});

test("keeps locale, currency, date-time, and direction independent", () => {
  const runtime = createInternationalizationRuntime({
    locale: "fr-CA",
    timeZone: "Europe/Paris",
    catalogue: {},
  });

  assert.match(runtime.formatMoney(1234.5, "EUR"), /1.?234,50/);
  const authoritativeUsd = runtime.formatMoney(10, "USD", { currency: "EUR", style: "decimal" });
  assert.match(authoritativeUsd, /\$/);
  assert.doesNotMatch(authoritativeUsd, /€/);
  assert.match(runtime.formatPercent(0.25), /25/);
  assert.match(runtime.formatDateTime("2025-01-15T12:00:00Z"), /15/);
  assert.equal(runtime.direction, "ltr");
  assert.equal(resolveLocaleDirection("ar-EG"), "rtl");
  assert.throws(() => runtime.formatMoney(10, "US"));
});

test("uses current and legacy direction APIs, then deterministic fallback", () => {
  const originalLocale = Intl.Locale;
  class FallbackLocale {
    constructor(private readonly value: string) {}

    toString(): string {
      return this.value;
    }
  }

  try {
    Object.defineProperty(Intl, "Locale", { configurable: true, value: FallbackLocale });
    assert.equal(resolveLocaleDirection("ar"), "rtl");
    assert.equal(resolveLocaleDirection("he"), "rtl");
    assert.equal(resolveLocaleDirection("fa"), "rtl");
    assert.equal(resolveLocaleDirection("ur"), "rtl");
    assert.equal(resolveLocaleDirection("en"), "ltr");
  } finally {
    Object.defineProperty(Intl, "Locale", { configurable: true, value: originalLocale });
  }
});

test("validates required complete catalogues and malformed ICU messages", () => {
  assert.doesNotThrow(() => validateIcuCatalogue(
    { welcome: "Welcome, {name}" },
    ["welcome"],
    { locale: "cs-CZ" },
  ));
  assert.throws(() => validateIcuCatalogue({}, ["welcome"]), /missing required keys/);
  assert.throws(() => validateIcuCatalogue({ welcome: "{name, plural, one {x}" }, ["welcome"]), /Invalid ICU message/);
});

test("uses an explicit fallback catalogue only when the primary catalogue lacks a key", () => {
  const runtime = createInternationalizationRuntime({
    locale: "en",
    catalogue: { primary: "Primary" },
    fallbackCatalogue: { fallback: "Fallback" },
  });

  assert.equal(runtime.t("primary"), "Primary");
  assert.equal(runtime.t("fallback"), "Fallback");
  assert.throws(() => runtime.t("missing"), /Missing ICU catalogue key/);
});