import assert from "node:assert/strict";
import test from "node:test";

import {
  CommerceAgentModelSelectionSchema,
  CommerceModelAvailabilitySchema,
  CommerceModelConfigurationSchema,
  CommerceModelSelectionSourceSchema,
  CommerceOpenRouterCredentialAadInputSchema,
  CommercePricingPlanModelAssignmentSchema,
  createCommerceOpenRouterCredentialAad,
  createOpenRouterModelId,
} from "./index.js";

test("model provider identity stays dynamic and combines deterministically", () => {
  assert.equal(createOpenRouterModelId({
    provider: "anthropic",
    providerModelId: "claude-sonnet-4.5",
  }), "anthropic/claude-sonnet-4.5");
});

test("availability and agent selection enforce scope discriminants", () => {
  assert.equal(CommerceModelAvailabilitySchema.safeParse({
    id: "platform", scope: "PLATFORM", shopId: null, enabled: true, editVersion: 1,
  }).success, true);
  assert.equal(CommerceModelAvailabilitySchema.safeParse({
    id: "platform", scope: "PLATFORM", shopId: "shop", enabled: true, editVersion: 1,
  }).success, false);
  assert.equal(CommerceAgentModelSelectionSchema.safeParse({
    environment: "TEST", scope: "SHOP", shopId: "shop", modelId: null, modelEditVersion: 1,
  }).success, true);
  assert.deepEqual(CommerceModelSelectionSourceSchema.options, ["PLATFORM", "PRICING_PLAN", "SHOP"]);
});

test("model configuration accepts direct extensible OpenRouter request options", () => {
  assert.equal(CommerceModelConfigurationSchema.safeParse({
    temperature: 0.2,
    top_p: 0.9,
    reasoning: { effort: "high" },
    provider: { allow_fallbacks: true, sort: "latency", data_collection: "deny", require_parameters: true },
    custom_unknown_option: { nested: [1, "valid"] },
  }).success, true);
  assert.equal(CommerceModelConfigurationSchema.safeParse({}).success, true);
});

test("reserved configuration keys are rejected only at the top level", () => {
  for (const key of [
    "model", "models", "messages", "tools", "tool_choice", "parallel_tool_calls",
    "stream", "stream_options", "max_tokens", "max_completion_tokens", "response_format",
    "api_key", "apiKey", "authorization", "headers", "base_url", "baseURL",
    "session_id", "sessionId", "trace", "user", "plugins", "web_search_options", "modalities",
  ]) {
    assert.equal(CommerceModelConfigurationSchema.safeParse({ [key]: "blocked" }).success, false, key);
  }
  assert.equal(CommerceModelConfigurationSchema.safeParse({ provider: { user: "latency" } }).success, true);
});

test("model configuration rejects nested prototype keys and enforces bounds", () => {
  const nested = JSON.parse('{"reasoning":{"constructor":{"prototype":1}}}');
  assert.equal(CommerceModelConfigurationSchema.safeParse(nested).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ key: "x".repeat(16385) }).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ key: "x".repeat(16000) }).success, true);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ key: Array(129).fill(1) }).success, false);
  let deep: unknown = "leaf";
  for (let index = 0; index < 9; index += 1) deep = { child: deep };
  assert.equal(CommerceModelConfigurationSchema.safeParse({ deep }).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ key: "x".repeat(32760) }).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse(Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`k${index}`, 1]))).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ ["k".repeat(129)]: 1 }).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ nested: { ["k".repeat(129)]: 1 } }).success, false);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ value: Number.POSITIVE_INFINITY }).success, false);
  const atNodeLimit = Array.from({ length: 128 }, (_, index) => Array(index === 127 ? 13 : 15).fill(0));
  const overNodeLimit = Array.from({ length: 128 }, (_, index) => Array(index === 127 ? 14 : 15).fill(0));
  assert.equal(CommerceModelConfigurationSchema.safeParse({ tree: atNodeLimit }).success, true);
  assert.equal(CommerceModelConfigurationSchema.safeParse({ tree: overNodeLimit }).success, false);
});

test("pricing plan assignment is strict and credential AAD is canonical", () => {
  assert.equal(CommercePricingPlanModelAssignmentSchema.safeParse({
    merchantPricingPlanId: "plan-1", shopifyPlanHandle: " basic ", modelId: null,
  }).success, true);
  assert.equal(CommercePricingPlanModelAssignmentSchema.safeParse({
    merchantPricingPlanId: "plan-1", shopifyPlanHandle: "basic", modelId: null, extra: true,
  }).success, false);
  const input = { environment: "PRODUCTION" as const, keyId: "key-1" };
  assert.equal(createCommerceOpenRouterCredentialAad(input), '{"credentialType":"OPENROUTER","environment":"PRODUCTION","keyId":"key-1"}');
  assert.equal(createCommerceOpenRouterCredentialAad(input), createCommerceOpenRouterCredentialAad(input));
  assert.notEqual(createCommerceOpenRouterCredentialAad(input), createCommerceOpenRouterCredentialAad({ ...input, keyId: "key-2" }));
  assert.notEqual(createCommerceOpenRouterCredentialAad(input), createCommerceOpenRouterCredentialAad({ ...input, environment: "STAGING" }));
  assert.equal(CommerceOpenRouterCredentialAadInputSchema.safeParse({ environment: "PRODUCTION", keyId: " " }).success, false);
  assert.equal(CommerceOpenRouterCredentialAadInputSchema.safeParse({ environment: "PRODUCTION", keyId: "x".repeat(65) }).success, false);
});