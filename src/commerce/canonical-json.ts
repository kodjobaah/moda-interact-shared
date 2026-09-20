/** Bounded canonical JSON. No credentials, hashing runtime or provider access. */
export function canonicalJson(
  value: unknown,
  order: "codepoint" | "utf16" = "codepoint",
): string {
  const seen = new Set<object>();
  const compare = (a: string, b: string) => {
    const aa = Array.from(a, (c) => c.codePointAt(0)!);
    const bb = Array.from(b, (c) => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++)
      if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return aa.length - bb.length;
  };
  function visit(v: unknown, depth: number): string {
    if (depth > 32) throw new TypeError("JSON depth exceeded");
    if (v === null) return "null";
    if (typeof v === "string") {
      if (/\p{Surrogate}/u.test(v)) throw new TypeError("Invalid Unicode");
      return JSON.stringify(v);
    }
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || !v || seen.has(v))
      throw new TypeError("Invalid JSON");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new TypeError("Invalid JSON object");
    seen.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new TypeError("Sparse or extended array");
      result = "[" + v.map((item) => visit(item, depth + 1)).join(",") + "]";
    } else {
      const keys = Object.keys(v).sort(
        order === "codepoint" ? compare : undefined,
      );
      result =
        "{" +
        keys
          .map(
            (k) =>
              visit(k, depth + 1) +
              ":" +
              visit((v as Record<string, unknown>)[k], depth + 1),
          )
          .join(",") +
        "}";
    }
    seen.delete(v);
    return result;
  }
  return visit(value, 0);
}
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(canonicalJson(value)).length;
/** RFC8785 sorts UTF-16 code units; JSON.stringify supplies ECMAScript number serialization. */
export const responseContractCanonicalJson = (value: unknown) =>
  canonicalJson(value, "utf16");
export type Digest = (canonical: string) => string;
