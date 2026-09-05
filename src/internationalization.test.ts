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