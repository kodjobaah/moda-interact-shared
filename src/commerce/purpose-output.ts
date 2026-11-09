import { z } from "zod";
import { canonicalJson, jsonBytes } from "./canonical-json";
import { safeName } from "./subset";

/** Purpose outputs preserve registered wire shapes, with implicit finite runtime
 * caps of 4096 string characters / 128 array members when omitted by descriptors.
 * These caps and the 32 KiB total result budget always apply, including unions. */
export type CommercePurposeOutputSchema = {
  type?: string | [string, "null"];
  anyOf?: CommercePurposeOutputSchema[];
  oneOf?: CommercePurposeOutputSchema[];
  const?: string | number | boolean | null;
  description?: string;
  properties?: Record<string, CommercePurposeOutputSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: CommercePurposeOutputSchema;
  enum?: (string | number | boolean | null)[];
  minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number;
  minItems?: number; maxItems?: number;
  pattern?: string; format?: "uri" | "date-time";
};

// Exact emitted canonical schema spellings. Caller text is compared, never executed.
const CANONICAL_PATTERNS = [
  "^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\\.[0-9]+)?Z(?![\\s\\S])",
  "^[0-9]{1,18}(\\.[0-9]{1,6})?$",
  "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
  "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$"
] as const;
const MONEY = CANONICAL_PATTERNS.find(pattern => pattern.includes("1,18"))!;
const STRICT_DATETIME = CANONICAL_PATTERNS.find(pattern => pattern.includes("2468"))!;
const DATETIME = CANONICAL_PATTERNS.find(pattern => pattern !== MONEY && pattern !== STRICT_DATETIME)!;
const MINUTE_DATETIME = CANONICAL_PATTERNS[3];
const scalarTypes = ["string", "number", "integer", "boolean", "object", "array"];
const baseKeys = ["type", "description", "enum", "const"];
const typeKeys: Record<string, string[]> = {
  object: ["properties", "required", "additionalProperties"],
  array: ["items", "minItems", "maxItems"],
  string: ["minLength", "maxLength", "pattern", "format"],
  number: ["minimum", "maximum"], integer: ["minimum", "maximum"], boolean: [],
};
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
}
function datetime(value: string, allowMinutes = false): boolean {
  // Only code-owned, linear fixed syntax; no caller regex compilation.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(value);
  if (!match || match[0].length !== value.length) return false;
  const [, y, m, d, h, minute, second] = match;
  if (!allowMinutes && second === undefined) return false;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(h) <= 23 && Number(minute) <= 59 && Number(second ?? 0) <= 59;
}
export function validateCommercePurposeOutputSchema(value: unknown): value is CommercePurposeOutputSchema {
  let nodes = 0, properties = 0;
  function walk(raw: unknown, depth: number, root = false): boolean {
    if (depth > 8 || ++nodes > 256 || !record(raw)) return false;
    const s = raw as CommercePurposeOutputSchema;
    if (s.description !== undefined && (typeof s.description !== "string" || s.description.length > 1000)) return false;
    if (Object.hasOwn(s, 'anyOf') || Object.hasOwn(s, 'oneOf')) {
      const key = Object.hasOwn(s, 'oneOf') ? 'oneOf' : 'anyOf';
      const branches=s[key];
      return Object.keys(s).every(name=>[key,'description'].includes(name))
        && Array.isArray(branches)&&branches.length>=2&&branches.length<=4
        && branches.every(branch=>walk(branch,depth+1,root));
    }
    const nullable = Array.isArray(s.type);
    if (nullable && (s.type!.length !== 2 || s.type![1] !== "null")) return false;
    const type = nullable ? s.type![0] : s.type;
    if (typeof type !== "string" || !scalarTypes.includes(type) || (root && (type !== "object" || nullable))) return false;
    if (Object.keys(s).some(key => ![...baseKeys, ...typeKeys[type]!].includes(key))) return false;
    if(Object.hasOwn(s,'const')) {
      const value=s.const;
      if(Object.hasOwn(s,'enum') || (value===null ? !nullable :
        typeof value!==(type==='integer'?'number':type)
        || !['string','number','boolean'].includes(typeof value)
        || (typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER||(type==='integer'&&!Number.isSafeInteger(value))))
        || (typeof value==='string'&&value.length>4096)))return false;
    }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || s.enum.length < 1 || s.enum.length > 32
      || new Set(s.enum.map(v => canonicalJson(v))).size !== s.enum.length
      || s.enum.some(v => v === null ? !nullable : typeof v !== (type === "integer" ? "number" : type)
        || (type === "integer" && !Number.isSafeInteger(v)) || typeof v === "object"))) return false;
    for (const [min, max] of [["minLength", "maxLength"], ["minItems", "maxItems"], ["minimum", "maximum"]] as const) {
      if ([s[min], s[max]].some(v => v !== undefined && (typeof v !== "number" || !Number.isFinite(v)
        || (min !== "minimum" && (!Number.isSafeInteger(v) || v < 0))))) return false;
      if (s[min] !== undefined && s[max] !== undefined && s[min]! > s[max]!) return false;
    }
    if (type === "string") return (s.maxLength === undefined || s.maxLength <= 4096)
      && (s.minLength ?? 0) <= (s.maxLength ?? 4096)
      && (s.pattern === undefined || CANONICAL_PATTERNS.includes(s.pattern as never))
      && (s.format === undefined || s.format === "uri" || s.format === "date-time");
    if (type === "array") return (s.maxItems === undefined || s.maxItems <= 128)
      && (s.minItems ?? 0) <= (s.maxItems ?? 128) && walk(s.items, depth + 1);
    if (type === "object") {
      if (s.additionalProperties !== false || !record(s.properties)) return false;
      const names = Object.keys(s.properties); properties += names.length;
      return properties <= 128 && names.every(safeName)
        && (s.required === undefined || (Array.isArray(s.required) && new Set(s.required).size === s.required.length
          && s.required.every(name => typeof name === "string" && names.includes(name))))
        && Object.values(s.properties).every(child => walk(child, depth + 1));
    }
    return true;
  }
  try { return jsonBytes(value) <= 32768 && walk(value, 1, true); } catch { return false; }
}
export const CommercePurposeOutputSchemaSchema = z.custom<CommercePurposeOutputSchema>(validateCommercePurposeOutputSchema);
function matches(schema: CommercePurposeOutputSchema, value: unknown): boolean {
  if (schema.oneOf) return schema.oneOf.filter(branch=>matches(branch,value)).length===1;
  if (schema.anyOf) return schema.anyOf.some(branch => matches(branch, value));
  const nullable = Array.isArray(schema.type);
  const type = nullable ? schema.type![0] : schema.type;
  if(Object.hasOwn(schema,'const')&&value!==schema.const)return false;
  if (value === null) return nullable && (!schema.enum || schema.enum.includes(null));
  if (schema.enum && !schema.enum.includes(value as never)) return false;
  if (type === "string") {
    if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 4096)) return false;
    if (schema.pattern === MONEY && (!/^[0-9]{1,18}(\.[0-9]{1,6})?$/.test(value) || /[\r\n]/.test(value))) return false;
    if (schema.pattern === DATETIME && !datetime(value)) return false;
    if ((schema.pattern === STRICT_DATETIME || schema.pattern === MINUTE_DATETIME || schema.format === "date-time")
      && !datetime(value, schema.pattern !== STRICT_DATETIME)) return false;
    if (schema.format === "uri") { try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.port) return false; } catch { return false; } }
    return true;
  }
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number" || type === "integer") return typeof value === "number" && Number.isFinite(value)
    && (type !== "integer" || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (type === "array") return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= (schema.maxItems ?? 128) && value.every(item => matches(schema.items!, item));
  if (!record(value)) return false;
  return Object.keys(value).every(key => Object.hasOwn(schema.properties!, key))
    && (schema.required ?? []).every(key => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, child]) => matches(schema.properties![key]!, child));
}
/** One canonical consumer compiler: validates schema first; validates complete JSON
 * result without projection, coercion or changing existing generic Details users. */
export function compileCommercePurposeOutputSchema(raw: unknown) {
  if (!validateCommercePurposeOutputSchema(raw)) throw new TypeError("Unsupported purpose output schema");
  const snapshot = structuredClone(raw);
  return z.custom<Record<string, unknown>>(value => {
    try { return jsonBytes(value) <= 32768 && matches(snapshot, value); } catch { return false; }
  });
}
