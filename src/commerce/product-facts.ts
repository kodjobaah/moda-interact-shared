import { z } from "zod";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

const codePoints = (value: string) => Array.from(value).length;
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u;
const label = z.string().min(1).refine(value => codePoints(value) <= 128 && value === value.trim() && !/[\r\n\t]/u.test(value) && !controls.test(value));
const status = z.enum(["AVAILABLE", "NOT_PROVIDED", "PARTIAL"]);
export const CommerceProductDescriptionSchema = z.strictObject({status, text: z.string().refine(value => codePoints(value) <= 4096 && !controls.test(value))})
  .refine(value => (value.status !== "NOT_PROVIDED" || value.text === "") && (value.status !== "AVAILABLE" || value.text.trim().length > 0));
export const CommerceProductAttributesSchema = z.strictObject({status, items: z.array(z.strictObject({name: label, values: z.array(label).max(64)})).max(16)})
  .refine(value => (value.status !== "NOT_PROVIDED" || value.items.length === 0) && (value.status !== "AVAILABLE" || value.items.length > 0))
  .refine(value => new Set(value.items.map(item => item.name)).size === value.items.length && value.items.every(item => new Set(item.values).size === item.values.length));
export type CommerceProductDescription = z.infer<typeof CommerceProductDescriptionSchema>;
export type CommerceProductAttributes = z.infer<typeof CommerceProductAttributesSchema>;

/** Native provider mapping chooses the format explicitly; this never guesses HTML. */
export function normalizeCommerceProductDescription(source: unknown, format: "PLAIN_TEXT" | "HTML"): CommerceProductDescription {
  if (source === null || source === undefined || source === "") return {status:"NOT_PROVIDED",text:""};
  if (typeof source !== "string" || !["PLAIN_TEXT","HTML"].includes(format)) return {status:"PARTIAL",text:""};
  if (new TextEncoder().encode(source).length > 65536) return {status:"PARTIAL",text:""};
  let partial = controls.test(source);
  let text = source;
  if (format === "HTML") {
    const lines: string[] = [];
    const boundaries = new Set(["br","p","div","li","ul","ol","h1","h2","h3","h4","h5","h6","table","tr"]);
    const skip = new Set(["script","style","template","noscript"]);
    const walk = (node: DefaultTreeAdapterMap["node"]): void => {
      if ("tagName" in node && skip.has(node.tagName)) return;
      const boundary = "tagName" in node && boundaries.has(node.tagName);
      if (boundary) lines.push("\n");
      if (node.nodeName === "#text" && "value" in node) lines.push(node.value);
      if ("childNodes" in node) for (const child of node.childNodes) walk(child);
      if (boundary && !("tagName" in node && node.tagName === "br")) lines.push("\n");
    };
    try { walk(parseFragment(source, {onParseError: () => {partial = true;}})); text = lines.join(""); }
    catch { return {status:"PARTIAL",text:""}; }
  }
  partial ||= controls.test(text);
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/gu, "").replace(/\r\n?/gu,"\n").replace(/[^\S\n]+/gu," ").replace(/\n{3,}/gu,"\n\n").trim();
  if (codePoints(text) > 4096) {text = Array.from(text).slice(0,4096).join(""); partial = true;}
  return {status:partial?"PARTIAL":text?"AVAILABLE":"NOT_PROVIDED",text};
}

/** Canonical name/values input only; provider-native attribute mapping stays with consumers. */
export function normalizeCommerceProductAttributes(source: unknown): CommerceProductAttributes {
  if (source === undefined || source === null) return {status:"NOT_PROVIDED",items:[]};
  const canonical = source && typeof source === "object" && !Array.isArray(source) ? source as {status?:unknown;items?:unknown} : null;
  const rows = canonical ? canonical.items : source;
  if (!Array.isArray(rows)) return {status:"PARTIAL",items:[]};
  let partial = !!canonical && (!["AVAILABLE","NOT_PROVIDED"].includes(String(canonical.status)) || (canonical.status === "NOT_PROVIDED" && rows.length > 0));
  const items: CommerceProductAttributes["items"] = [];
  const clean = (raw: unknown): string | null => {
    if (typeof raw !== "string" || controls.test(raw)) return null;
    const value = raw.replace(/[\r\n\t]/gu," ").replace(/\s+/gu," ").trim();
    return value && codePoints(value) <= 128 ? value : null;
  };
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {partial=true;continue;}
    const row = raw as {name?:unknown;values?:unknown};
    const name = clean(row.name);
    if (!name || !Array.isArray(row.values)) {partial=true;continue;}
    let item = items.find(value => value.name === name);
    if (!item) {if(items.length>=16){partial=true;continue;}item={name,values:[]};items.push(item);}
    for(const rawValue of row.values){const value=clean(rawValue);if(!value){partial=true;continue;}if(item.values.includes(value))continue;if(item.values.length>=64){partial=true;continue;}item.values.push(value);}
  }
  return {status:partial?"PARTIAL":items.length?"AVAILABLE":"NOT_PROVIDED",items};
}

/** The wire boundary receives normalized plain text, never provider HTML. */
export function normalizeCommerceProductDescriptionField(source: unknown): CommerceProductDescription {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {status:"PARTIAL",text:""};
  const value = source as {status?:unknown;text?:unknown};
  if (typeof value.text !== "string") return {status:"PARTIAL",text:""};
  const normalized = normalizeCommerceProductDescription(value.text,"PLAIN_TEXT");
  if (!status.safeParse(value.status).success || value.status === "PARTIAL" || (value.status === "NOT_PROVIDED" && normalized.text)) normalized.status = "PARTIAL";
  return normalized;
}
