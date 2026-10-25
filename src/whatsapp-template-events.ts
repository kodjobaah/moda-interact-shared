import { z } from "zod";

/** The existing WhatsApp event queue; this observation is a distinct job type. */
export const META_TEMPLATE_STATUS_QUEUE = "whatsapp-events" as const;
export const META_TEMPLATE_STATUS_JOB = "meta-template-status-update" as const;
export const META_TEMPLATE_STATUS_SCHEMA_VERSION = 2 as const;

const MAX_JSON_BYTES = 4096;
const REQUIRED_JSON_KEYS = [
  "schemaVersion",
  "eventIdentity",
  "wabaId",
  "providerTemplateId",
  "providerTemplateName",
  "providerLanguageCode",
  "providerStatus",
  "reasonCode",
  "receivedAt",
] as const;

// Explicitly require a lowercase, RFC 4122 / RFC 9562 variant UUID *version 4*.
// Meta does not supply an occurrence ID for this webhook: the authenticated
// Messaging producer creates a fresh random UUID v4, not Shared.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_IDENTITY_PREFIX = "meta-template-status:v2:";
const JOB_ID_PREFIX = "meta-template-status-v2-";
const EVENT_IDENTITY = /^meta-template-status:v2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL_PROVIDER_ID = /^[0-9]{1,32}$/;
const CANONICAL_UTC_RECEIPT = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function providerText(maxLength: number) {
  return z.string().min(1).max(maxLength).refine(
    (value) => value.trim().length > 0 && !CONTROL_CHARACTERS.test(value),
    { message: "Invalid Meta provider text" },
  );
}

const canonicalReceivedAt = z.string().regex(CANONICAL_UTC_RECEIPT).refine(
  (value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  },
  { message: "receivedAt must be a valid canonical UTC millisecond timestamp" },
);

const observationFields = z.object({
  schemaVersion: z.literal(META_TEMPLATE_STATUS_SCHEMA_VERSION),
  eventIdentity: z.string().regex(EVENT_IDENTITY),
  wabaId: z.string().regex(DECIMAL_PROVIDER_ID),
  providerTemplateId: z.string().regex(DECIMAL_PROVIDER_ID).nullable(),
  providerTemplateName: providerText(255),
  providerLanguageCode: providerText(16),
  // Unknown but well-formed provider statuses remain text. The Background
  // consumer, not this transport contract, interprets provider state.
  providerStatus: providerText(32),
  reasonCode: providerText(128).nullable(),
  // Receipt time is diagnostic, never a provider-status ordering authority.
  receivedAt: canonicalReceivedAt,
}).strict();

/**
 * Consumer and producer boundary schema. Preflight checks the *actual* UTF-8
 * JSON encoding and exact own-key set before the typed, non-coercing Zod parse.
 * It does not log rejected payloads or parse Meta business status semantics.
 */
export const MetaTemplateStatusObservationV2Schema = z.unknown().superRefine(
  (input, ctx) => {
    let json: string | undefined;
    try {
      json = JSON.stringify(input);
    } catch {
      // A circular / non-JSON payload is not a valid BullMQ wire observation.
    }
    if (typeof json !== "string") {
      ctx.addIssue({ code: "custom", message: "Meta template-status observation must be JSON-serializable" });
      return;
    }
    if (new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) {
      ctx.addIssue({ code: "custom", message: "Meta template-status observation exceeds 4096 UTF-8 bytes" });
      return;
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== REQUIRED_JSON_KEYS.length
      || !REQUIRED_JSON_KEYS.every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
      ctx.addIssue({ code: "custom", message: "Meta template-status observation requires exactly nine own JSON fields" });
    }
  },
).pipe(observationFields);

export type MetaTemplateStatusObservationV2 = z.infer<typeof MetaTemplateStatusObservationV2Schema>;

function validateObservationId(observationId: string): void {
  if (typeof observationId !== "string" || !UUID_V4.test(observationId)) {
    // Do not interpolate potentially untrusted identifiers into exceptions.
    throw new TypeError("observationId must be a lowercase UUID v4");
  }
}

/** Identity of one authenticated observation; never a content fingerprint. */
export function formatMetaTemplateStatusEventIdentity(observationId: string): string {
  validateObservationId(observationId);
  return `${EVENT_IDENTITY_PREFIX}${observationId}`;
}

/** BullMQ-compatible job ID: the same UUID, without ':' separators. */
export function formatMetaTemplateStatusJobId(observationId: string): string {
  validateObservationId(observationId);
  return `${JOB_ID_PREFIX}${observationId}`;
}
