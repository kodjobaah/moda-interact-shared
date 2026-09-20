import { z } from "zod";
import {
  canonicaliseLanguageTag,
  normalizeCurrencyCode,
} from "../internationalization";
import { jsonBytes } from "./canonical-json";
export const ContractVersionSchema = z.literal("commerce.v1");
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (v) =>
      v.trim() === v &&
      !["standalone", "product-only", "unknown-shop"].includes(v),
  );
export const SemverSchema = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const DateSchema = z.iso.datetime({ offset: false });
export const MoneySchema = z.string().regex(/^[0-9]{1,18}(\.[0-9]{1,6})?$/);
export const CurrencySchema = z.string().refine((v) => {
  try {
    return normalizeCurrencyCode(v) === v;
  } catch {
    return false;
  }
});
export const LanguageSchema = z
  .string()
  .max(128)
  .refine((v) => {
    try {
      return canonicaliseLanguageTag(v) === v;
    } catch {
      return false;
    }
  });
export const distinct = <T>(values: T[]) =>
  new Set(values).size === values.length;
export const boundedJson = (bytes: number) =>
  z.unknown().refine((v) => {
    try {
      return jsonBytes(v) <= bytes;
    } catch {
      return false;
    }
  });
