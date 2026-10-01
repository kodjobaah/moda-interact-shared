import { z } from "zod";

import { canonicalJson } from "../canonical-json.js";

export const COMMERCE_MODEL_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export const COMMERCE_MODEL_CONFIGURATION_RESERVED_KEYS = [
  "model", "models", "messages", "tools", "tool_choice", "parallel_tool_calls",
  "stream", "stream_options", "max_tokens", "max_completion_tokens", "response_format",
  "api_key", "apiKey", "authorization", "headers", "base_url", "baseURL",
  "session_id", "sessionId", "trace", "user", "plugins", "web_search_options", "modalities",
] as const;

export const CommerceEnvironmentSchema = z.enum([
  "LOCAL", "TEST", "DEVELOPMENT", "STAGING", "PRODUCTION",
]);
export type CommerceEnvironment = z.infer<typeof CommerceEnvironmentSchema>;

export const CommerceModelAvailabilityScopeSchema = z.enum(["PLATFORM", "SHOP"]);
export type CommerceModelAvailabilityScope = z.infer<typeof CommerceModelAvailabilityScopeSchema>;

export const CommerceModelAvailabilitySchema = z.discriminatedUnion("scope", [
  z.strictObject({
    id: z.string().min(1).max(128), scope: z.literal("PLATFORM"), shopId: z.null(),
    enabled: z.boolean(), editVersion: z.number().int().positive(),
  }),
  z.strictObject({
    id: z.string().min(1).max(128), scope: z.literal("SHOP"),
    shopId: z.string().min(1).max(128), enabled: z.boolean(),
    editVersion: z.number().int().positive(),
  }),
]);
export type CommerceModelAvailability = z.infer<typeof CommerceModelAvailabilitySchema>;

export const CommerceModelProviderSchema = z.string().min(1).max(64)
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export type CommerceModelProvider = z.infer<typeof CommerceModelProviderSchema>;
export const CommerceProviderModelIdSchema = z.string().min(1).max(255).regex(/^[^\s/]+$/);
export type CommerceProviderModelId = z.infer<typeof CommerceProviderModelIdSchema>;

export function createOpenRouterModelId(input: {
  provider: CommerceModelProvider;
  providerModelId: CommerceProviderModelId;
}): string {
  return `${CommerceModelProviderSchema.parse(input.provider)}/${CommerceProviderModelIdSchema.parse(input.providerModelId)}`;
}

export type CommerceModelJsonValue = null | boolean | number | string |
  CommerceModelJsonValue[] | { [key: string]: CommerceModelJsonValue };
export type CommerceModelConfiguration = { [key: string]: CommerceModelJsonValue };

const prototypeKeys = new Set(["__proto__", "prototype", "constructor"]);
const reservedKeys = new Set<string>(COMMERCE_MODEL_CONFIGURATION_RESERVED_KEYS);

function validConfiguration(value: unknown): value is CommerceModelConfiguration {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const rootPrototype = Object.getPrototypeOf(value);
  if (rootPrototype !== Object.prototype && rootPrototype !== null) return false;
  let nodes = 1;
  let valid = true;
  const visit = (entry: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 2048 || depth > 8) { valid = false; return; }
    if (entry === null || typeof entry === "boolean") return;
    if (typeof entry === "number") { if (!Number.isFinite(entry)) valid = false; return; }
    if (typeof entry === "string") { if (entry.length > 16384) valid = false; return; }
    if (Array.isArray(entry)) {
      if (entry.length > 128 || Object.keys(entry).length !== entry.length) { valid = false; return; }
      for (const item of entry) visit(item, depth + 1);
      return;
    }
    if (typeof entry !== "object") { valid = false; return; }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) { valid = false; return; }
    const keys = Object.keys(entry);
    if (keys.length > 128) { valid = false; return; }
    for (const key of keys) {
      if (key.length > 128 || prototypeKeys.has(key)) valid = false;
      visit((entry as Record<string, unknown>)[key], depth + 1);
    }
  };
  const configuration = value as Record<string, unknown>;
  const keys = Object.keys(configuration);
  if (keys.length > 128) return false;
  for (const key of keys) {
    if (reservedKeys.has(key) || key.length > 128 || prototypeKeys.has(key)) valid = false;
    visit(configuration[key], 1);
  }
  if (!valid) return false;
  try { return new TextEncoder().encode(canonicalJson(configuration)).length <= 32768; }
  catch { return false; }
}

export const CommerceModelConfigurationSchema = z.custom<CommerceModelConfiguration>(
  validConfiguration, { message: "Invalid Commerce model configuration" },
);

export const CommerceModelCatalogueEntrySchema = z.strictObject({
  id: z.string().min(1).max(128), availabilityId: z.string().min(1).max(128),
  provider: CommerceModelProviderSchema, providerModelId: CommerceProviderModelIdSchema,
  displayName: z.string().min(1).max(160), description: z.string().max(2000),
  configurationSchemaVersion: z.literal(COMMERCE_MODEL_CONFIGURATION_SCHEMA_VERSION),
  configuration: CommerceModelConfigurationSchema, enabled: z.boolean(),
  editVersion: z.number().int().positive(),
});
export type CommerceModelCatalogueEntry = z.infer<typeof CommerceModelCatalogueEntrySchema>;

export const CommerceAgentModelSelectionSchema = z.discriminatedUnion("scope", [
  z.strictObject({ environment: CommerceEnvironmentSchema, scope: z.literal("PLATFORM"),
    shopId: z.null(), modelId: z.string().min(1).max(128), modelEditVersion: z.number().int().positive() }),
  z.strictObject({ environment: CommerceEnvironmentSchema, scope: z.literal("SHOP"),
    shopId: z.string().min(1).max(128), modelId: z.string().min(1).max(128).nullable(),
    modelEditVersion: z.number().int().positive() }),
]);
export type CommerceAgentModelSelection = z.infer<typeof CommerceAgentModelSelectionSchema>;

export const CommerceModelSelectionSourceSchema = z.enum(["PLATFORM", "PRICING_PLAN", "SHOP"]);
export type CommerceModelSelectionSource = z.infer<typeof CommerceModelSelectionSourceSchema>;

export const CommercePricingPlanModelAssignmentSchema = z.strictObject({
  merchantPricingPlanId: z.string().min(1).max(128),
  shopifyPlanHandle: z.string().trim().min(1).max(255),
  modelId: z.string().min(1).max(128).nullable(),
});
export type CommercePricingPlanModelAssignment = z.infer<typeof CommercePricingPlanModelAssignmentSchema>;

export const ResolvedCommerceModelSchema = z.strictObject({
  environment: CommerceEnvironmentSchema, sourceScope: CommerceModelAvailabilityScopeSchema,
  sourceShopId: z.string().min(1).max(128).nullable(), catalogueEntryId: z.string().min(1).max(128),
  provider: CommerceModelProviderSchema, providerModelId: CommerceProviderModelIdSchema,
  configurationSchemaVersion: z.literal(COMMERCE_MODEL_CONFIGURATION_SCHEMA_VERSION),
  configuration: CommerceModelConfigurationSchema,
});
export type ResolvedCommerceModel = z.infer<typeof ResolvedCommerceModelSchema>;

export const COMMERCE_OPENROUTER_CREDENTIAL_TYPE = "OPENROUTER" as const;
export const CommerceOpenRouterCredentialAadInputSchema = z.strictObject({
  environment: CommerceEnvironmentSchema, keyId: z.string().trim().min(1).max(64),
});
export type CommerceOpenRouterCredentialAadInput = z.infer<typeof CommerceOpenRouterCredentialAadInputSchema>;

export function createCommerceOpenRouterCredentialAad(input: CommerceOpenRouterCredentialAadInput): string {
  const parsed = CommerceOpenRouterCredentialAadInputSchema.parse(input);
  return canonicalJson({
    credentialType: COMMERCE_OPENROUTER_CREDENTIAL_TYPE,
    environment: parsed.environment,
    keyId: parsed.keyId,
  });
}