import { z } from "zod";
import { canonicalJson, jsonBytes } from "./canonical-json";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type SubsetSchema = {
  type: string | [string, "null"];
  description?: string;
  properties?: Record<string, SubsetSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: SubsetSchema;
  enum?: Array<string | number | boolean | null>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};
export const MONEY_PATTERN = "^[0-9]{1,18}(\\.[0-9]{1,6})?$";
export const safeName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) &&
  !["__proto__", "prototype", "constructor"].includes(name);
export const safePath = (path: string) =>
  path.length <= 256 && path.split(".").every(safeName);
const keywords = [
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
];
export function validateSubset(
  value: unknown,
  mode: "input" | "details",
): value is SubsetSchema {
  let propertyCount = 0;
  const maxDepth = mode === "input" ? 3 : 4;
  function walk(raw: unknown, depth: number): boolean {
    if (
      depth > maxDepth ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    )
      return false;
    const s = raw as SubsetSchema;
    if (
      Object.keys(s).some(
        (k) => !keywords.includes(k) && !(mode === "input" && k === "pattern"),
      )
    )
      return false;
    const nullable = Array.isArray(s.type);
    if (
      nullable &&
      (mode !== "input" || s.type.length !== 2 || s.type[1] !== "null")
    )
      return false;
    const type = typeof s.type === "string" ? s.type : s.type[0];
    if (
      ![
        "object",
        "string",
        "integer",
        "boolean",
        "array",
        ...(mode === "details" ? ["number"] : []),
      ].includes(type)
    )
      return false;
    if (
      s.description !== undefined &&
      (typeof s.description !== "string" || s.description.length > 1000)
    )
      return false;
    const specific: Record<string, string[]> = {
      object: ["properties", "required", "additionalProperties"],
      array: ["items", "minItems", "maxItems"],
      string: ["minLength", "maxLength", "pattern"],
      integer: ["minimum", "maximum"],
      number: ["minimum", "maximum"],
      boolean: [],
    };
    if (
      Object.keys(s).some(
        (k) =>
          !["type", "description", "enum"].includes(k) &&
          !specific[type].includes(k),
      )
    )
      return false;
    if (
      s.enum !== undefined &&
      (!Array.isArray(s.enum) ||
        s.enum.length < 1 ||
        s.enum.length > (mode === "input" ? 32 : 20) ||
        new Set(s.enum.map((v) => canonicalJson(v))).size !== s.enum.length ||
        s.enum.some((v) =>
          v === null
            ? !nullable
            : typeof v !== (type === "integer" ? "number" : type) ||
              (type === "integer" && !Number.isSafeInteger(v)) ||
              typeof v === "object",
        ))
    )
      return false;
    for (const [lo, hi] of [
      ["minLength", "maxLength"],
      ["minItems", "maxItems"],
      ["minimum", "maximum"],
    ] as const) {
      if (
        s[lo] !== undefined &&
        (typeof s[lo] !== "number" || !Number.isFinite(s[lo]))
      )
        return false;
      if (
        s[hi] !== undefined &&
        (typeof s[hi] !== "number" || !Number.isFinite(s[hi]))
      )
        return false;
      if (
        lo !== "minimum" &&
        [s[lo], s[hi]].some(
          (v) => v !== undefined && (!Number.isSafeInteger(v) || v < 0),
        )
      )
        return false;
      if (s[lo] !== undefined && s[hi] !== undefined && s[lo]! > s[hi]!)
        return false;
    }
    if (type === "string")
      return (
        s.maxLength !== undefined &&
        s.maxLength <= 4096 &&
        (s.pattern === undefined || s.pattern === MONEY_PATTERN)
      );
    if (type === "array")
      return (
        s.maxItems !== undefined &&
        s.maxItems <= (mode === "input" ? 100 : 20) &&
        walk(s.items, depth + 1)
      );
    if (type === "object") {
      if (
        s.additionalProperties !== false ||
        !s.properties ||
        typeof s.properties !== "object" ||
        Array.isArray(s.properties)
      )
        return false;
      const names = Object.keys(s.properties);
      propertyCount += names.length;
      if (
        propertyCount > 32 ||
        names.some((n) => !safeName(n)) ||
        (s.required !== undefined &&
          (!Array.isArray(s.required) ||
            new Set(s.required).size !== s.required.length ||
            s.required.some((n) => !names.includes(n))))
      )
        return false;
      return Object.values(s.properties).every((child) =>
        walk(child, depth + 1),
      );
    }
    return true;
  }
  try {
    return (
      jsonBytes(value) <= 32768 &&
      walk(value, 1) &&
      (value as SubsetSchema).type === "object"
    );
  } catch {
    return false;
  }
}
export const InputSchemaSchema = z.custom<SubsetSchema>((v) =>
  validateSubset(v, "input"),
);
export const DetailsSchemaSchema = z.custom<SubsetSchema>((v) =>
  validateSubset(v, "details"),
);
export function matchesSubset(schema: SubsetSchema, value: unknown): boolean {
  const nullable = Array.isArray(schema.type);
  const type = typeof schema.type === "string" ? schema.type : schema.type[0];
  if (value === null)
    return nullable && (!schema.enum || schema.enum.includes(null));
  if (schema.enum && !schema.enum.includes(value as never)) return false;
  if (type === "string")
    return (
      typeof value === "string" &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= schema.maxLength! &&
      (!schema.pattern || new RegExp(schema.pattern).test(value))
    );
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer" || type === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (type !== "integer" || Number.isSafeInteger(value)) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (type === "array")
    return (
      Array.isArray(value) &&
      value.length >= (schema.minItems ?? 0) &&
      value.length <= schema.maxItems! &&
      value.every((v) => matchesSubset(schema.items!, v))
    );
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    Object.keys(obj).every((k) => Object.hasOwn(schema.properties!, k)) &&
    (schema.required ?? []).every((k) => Object.hasOwn(obj, k)) &&
    Object.entries(obj).every(([k, v]) =>
      matchesSubset(schema.properties![k], v),
    )
  );
}
export function compileSubset(schema: SubsetSchema, mode: "input" | "details") {
  if (!validateSubset(schema, mode)) throw new TypeError("Unsupported schema");
  return z.custom<Record<string, Json>>((value) => {
    try {
      return (
        jsonBytes(value) <= (mode === "details" ? 16384 : 131072) &&
        matchesSubset(schema, value)
      );
    } catch {
      return false;
    }
  });
}
