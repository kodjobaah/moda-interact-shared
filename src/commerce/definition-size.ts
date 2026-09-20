import { canonicalJson } from "./canonical-json";

/** Bytes of PostgreSQL jsonb::text for JSON.stringify-serialized values.
 * jsonb adds spaces after separators and expands exponent-form JSON numbers.
 * Key ordering changes no byte counts. This is not the canonical hash encoder.
 */
export function definitionStorageBytes(value: unknown): number {
  const normalized: unknown = JSON.parse(canonicalJson(value));
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  function size(v: unknown): number {
    if (typeof v === "number") {
      const text = JSON.stringify(v);
      if (!text.includes("e")) return text.length;
      const [coefficient, exponent] = text.split("e");
      const sign = coefficient.startsWith("-") ? 1 : 0;
      const unsigned = coefficient.slice(sign);
      const digits = unsigned.replace(".", "").length;
      const point =
        (unsigned.indexOf(".") < 0 ? unsigned.length : unsigned.indexOf(".")) +
        Number(exponent);
      return (
        sign +
        (point <= 0 ? 2 - point + digits : point >= digits ? point : digits + 1)
      );
    }
    if (Array.isArray(v))
      return (
        2 +
        Math.max(0, v.length - 1) * 2 +
        v.reduce((sum, item) => sum + size(item), 0)
      );
    if (v && typeof v === "object") {
      const entries = Object.entries(v);
      return (
        2 +
        Math.max(0, entries.length - 1) * 2 +
        entries.reduce(
          (sum, [key, item]) =>
            sum + bytes(JSON.stringify(key)) + 2 + size(item),
          0,
        )
      );
    }
    return bytes(JSON.stringify(v));
  }
  return size(normalized);
}
export const definitionFitsStorage = (value: unknown): boolean => {
  try {
    return definitionStorageBytes(value) <= 65536;
  } catch {
    return false;
  }
};
export const DEFINITION_SIZE_MESSAGE =
  "Definition exceeds the 65536-byte jsonb text limit";
