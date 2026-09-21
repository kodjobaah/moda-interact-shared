import { z } from "zod";
import { IdSchema } from "./primitives";
import { safeName, safePath } from "./subset";
import { jsonBytes } from "./canonical-json";

const utf8 = (value: string, maximum: number) => new TextEncoder().encode(value).length <= maximum;
const scalar = z.union([z.string().refine((value) => utf8(value, 2048)), z.number().finite(), z.boolean()]);
const scalarOrNull = z.union([scalar, z.null()]);
const record = <T extends z.ZodTypeAny>(item: T, max: number) => z.record(z.string().refine(safeName), item).refine((value) => Object.keys(value).length <= max);

export const ExternalQueryMappingSchema = z.union([
  z.strictObject({ input: z.string().refine(safeName), omitIfMissing: z.literal(true).optional() }),
  z.strictObject({ literal: scalar }),
]);
export const ExternalQueryMappingsSchema = record(ExternalQueryMappingSchema, 32).superRefine((value, ctx) => {
  const reserved = /^(authorization|cookie|set-cookie|host|x-api-key|api_key|apikey|access_token|token|secret|password)$/i;
  for (const key of Object.keys(value)) if (reserved.test(key)) ctx.addIssue({ code: "custom", path: [key], message: "Reserved query key" });
});
export const ExternalPathSchema = z.string().max(1024).refine((value) =>
  utf8(value, 1024) && /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*\/?$/.test(value) &&
  !value.includes("//") && !value.includes("%") && !value.includes("\\") &&
  !value.includes("?") && !value.includes("#") && !value.includes("{") && !value.includes("}"),
);
const mediaType = z.string().min(1).max(128).refine((value) => value === value.toLowerCase() && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value));
export const ExternalResponseFormatSchema = z.strictObject({ mode: z.enum(["JSON", "TEXT"]), mediaTypes: z.array(mediaType).min(1).max(8).refine((values) => new Set(values).size === values.length) });
export const FieldProjectionSchema = record(z.strictObject({ path: z.string().refine(safePath), omitIfMissing: z.literal(true).optional() }), 32).refine((value) => Object.keys(value).length >= 1);
export const ResponseFilterSchema = z.discriminatedUnion("op", [
  z.strictObject({ path: z.string().refine(safePath), op: z.enum(["EQ", "NE", "GT", "GTE", "LT", "LTE", "CONTAINS", "STARTS_WITH"]), value: scalarOrNull }),
  z.strictObject({ path: z.string().refine(safePath), op: z.literal("IN"), values: z.array(scalarOrNull).min(1).max(20) }),
]);
const visualObject = z.strictObject({ kind: z.literal("OBJECT"), fields: FieldProjectionSchema });
const visualList = z.strictObject({ kind: z.literal("LIST"), fields: FieldProjectionSchema, filters: z.array(ResponseFilterSchema).max(8), sort: z.union([z.null(), z.strictObject({ path: z.string().refine(safePath), direction: z.enum(["ASC", "DESC"]) })]), limit: z.int().min(1).max(20) });
export const VisualResponseProcessingSchema = z.union([visualObject, visualList]);
export const ResponseProcessingSchema = z.union([VisualResponseProcessingSchema, z.strictObject({ kind: z.literal("JAVASCRIPT"), runtimeVersion: z.literal("quickjs-sync.v1"), source: z.string().min(1).refine((value) => utf8(value, 16384)) })]);
export const TransformResponseSchema = z.strictObject({ status: z.int().min(200).max(299), contentType: z.string().min(1).max(128), bodyText: z.string().refine((value) => utf8(value, 262144)), json: z.union([z.null(), z.json()]) });
export const TransformSampleSchema = z.strictObject({ status: z.int().min(200).max(299), contentType: z.string().min(1).max(128), bodyText: z.string().refine((value) => utf8(value, 262144)) }).refine((value) => jsonBytes(value) <= 524288);
export const ConnectionRevisionViewSchema = z.strictObject({ id: IdSchema, connectionId: IdSchema, revisionNumber: z.int().positive(), origin: z.string().min(1).max(2048), scope: z.enum(["PLATFORM", "PER_SHOP"]), authMode: z.enum(["NONE", "BEARER", "API_KEY"]), authHeader: z.string().min(1).max(128).nullable(), documentation: z.string().max(16000), createdAt: z.iso.datetime({ offset: false }) });
export const ConnectionViewSchema = z.strictObject({ id: IdSchema, key: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/), displayName: z.string().min(1).max(255), description: z.string().max(4096), enabled: z.boolean(), editVersion: z.int().positive(), revisions: z.array(ConnectionRevisionViewSchema) });
export const CredentialStatusSchema = z.strictObject({ connectionRevisionId: IdSchema, shopId: IdSchema.nullable(), configured: z.boolean(), editVersion: z.int().positive().nullable(), updatedAt: z.iso.datetime({ offset: false }).nullable() });
export const ConnectionCommandSchema = z.strictObject({ operationId: IdSchema, reason: z.string().trim().min(1).max(1000) });
export const RevisionInputSchema = z.strictObject({ origin: z.string().min(1).max(2048), scope: z.enum(["PLATFORM", "PER_SHOP"]), authMode: z.enum(["NONE", "BEARER", "API_KEY"]), authHeader: z.string().min(1).max(128).nullable(), documentation: z.string().max(16000) });
export const ConnectionIssueSchema = z.strictObject({ path: z.string().max(256), message: z.string().min(1).max(512) });
export const ConnectionResultSchema = <T extends z.ZodType>(value: T) => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ok"), value }),
  z.strictObject({ kind: z.literal("not-found") }),
  z.strictObject({ kind: z.literal("forbidden") }),
  z.strictObject({ kind: z.literal("unavailable") }),
  z.strictObject({ kind: z.literal("invalid"), issues: z.array(ConnectionIssueSchema).max(32) }),
  z.strictObject({ kind: z.literal("conflict"), code: z.enum(["STALE_CAS", "CONFLICTING_REPLAY"]) }),
]);
export type ExternalResponseFormat = z.infer<typeof ExternalResponseFormatSchema>;
export type FieldProjection = z.infer<typeof FieldProjectionSchema>;
export type ResponseFilter = z.infer<typeof ResponseFilterSchema>;
export type VisualResponseProcessing = z.infer<typeof VisualResponseProcessingSchema>;
export type ResponseProcessing = z.infer<typeof ResponseProcessingSchema>;
export type TransformResponse = z.infer<typeof TransformResponseSchema>;
export type TransformSample = z.infer<typeof TransformSampleSchema>;
export type ConnectionRevisionView = z.infer<typeof ConnectionRevisionViewSchema>;
export type ConnectionView = z.infer<typeof ConnectionViewSchema>;
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;
export type ConnectionCommand = z.infer<typeof ConnectionCommandSchema>;
export type RevisionInput = z.infer<typeof RevisionInputSchema>;
export type ConnectionResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not-found" | "forbidden" | "unavailable" }
  | { kind: "invalid"; issues: Array<z.infer<typeof ConnectionIssueSchema>> }
  | { kind: "conflict"; code: "STALE_CAS" | "CONFLICTING_REPLAY" };
export type VisualResponseProcessorInput = { source: unknown; processing: VisualResponseProcessing; limits: { maxSearchResults: number; deadlineAt: number }; signal: AbortSignal };
export type VisualResponseProcessorResult = { ok: true; values: Record<string, unknown> } | { ok: false; code: "INVALID_RESPONSE" | "DEADLINE" | "CANCELLED" };
export type CodeResponseProcessorInput = { response: TransformResponse; processing: Extract<ResponseProcessing, { kind: "JAVASCRIPT" }>; limits: { maxSearchResults: number; deadlineAt: number }; signal: AbortSignal };
export type CodeResponseProcessorResult = { ok: true; values: Record<string, unknown> } | { ok: false; code: "INVALID_RESPONSE" | "DEADLINE" | "CANCELLED" | "THROTTLED"; diagnostic?: { code: "SYNTAX_ERROR" | "EXECUTION_ERROR" | "INVALID_OUTPUT" | "RESOURCE_LIMIT" | "RUNTIME_UNAVAILABLE"; line: number | null; column: number | null } };
