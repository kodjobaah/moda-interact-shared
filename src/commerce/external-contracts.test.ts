import assert from "node:assert/strict";
import test from "node:test";
import {
  CommerceToolDefinitionSchema,
  ConnectionCommandSchema,
  ConnectionViewSchema,
  ExternalHttpExecutionSchema,
  ExternalResponseFormatSchema,
  ResponseProcessingSchema,
  TransformSampleSchema,
  definitionToMcpDescriptor,
  mapToolArguments,
  validateDefinitionForPublication,
  type CommerceToolDefinition,
  type CommerceDefinitionCompiler,
} from "./index";

const execution = {
  kind: "EXTERNAL_HTTP" as const,
  executorVersion: "1.0.0" as const,
  connectionRevisionId: "connection-revision",
  method: "GET" as const,
  path: "/catalogue/item",
  query: { sku: { input: "sku" } },
  responseFormat: { mode: "JSON" as const, mediaTypes: ["application/json"] },
  resultPath: "data",
  responseProcessing: { kind: "OBJECT" as const, fields: { title: { path: "title" } } },
  resultSchema: { type: "object", properties: { title: { type: "string", maxLength: 200 } }, required: ["title"], additionalProperties: false as const },
};
const definition: CommerceToolDefinition = {
  name: "external_catalogue",
  definitionVersion: "1.0.0",
  description: "Reads external catalogue facts.",
  inputSchema: { type: "object", properties: { sku: { type: "string", minLength: 1, maxLength: 64 } }, required: ["sku"], additionalProperties: false },
  execution,
  responseTemplate: { kind: "text", text: "{{result.values.title}}", unavailable: "Unavailable." },
};
const compiler: CommerceDefinitionCompiler = {
  compile: () => {
    throw new Error("External wrapper output must be derived without a provider compiler");
  },
};
const ok = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(value);
const bad = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) => assert.equal(schema.safeParse(value).success, false);

test("X01 external GET definition accepts the C21 example and keeps existing descriptors non-sensitive", () => {
  ok(CommerceToolDefinitionSchema, definition);
  assert.deepEqual({ ...mapToolArguments(definition, { sku: "coat" }) }, { sku: "coat" });
  assert.equal(validateDefinitionForPublication(definition, compiler).name, definition.name);
  assert.deepEqual(definitionToMcpDescriptor(definition), { name: definition.name, description: definition.description, inputSchema: definition.inputSchema });
});

test("X01 rejects writes, authority paths, unsafe mappings and malformed processing", () => {
  for (const patch of [
    { method: "POST" },
    { path: "https://example.test/a" },
    { path: "/a//b" },
    { path: "/a%2fb" },
    { query: { token: { literal: "secret" } } },
    { query: { sku: { input: "unknown" } } },
    { query: { sku: { input: "nested" } } },
    { resultPath: "data", responseProcessing: { kind: "JAVASCRIPT", runtimeVersion: "quickjs-sync.v1", source: "function transform() { return {}; }" } },
    { responseFormat: { mode: "TEXT", mediaTypes: ["text/plain"] }, responseProcessing: execution.responseProcessing },
  ]) bad(CommerceToolDefinitionSchema, { ...definition, execution: { ...execution, ...patch } });
  bad(CommerceToolDefinitionSchema, { ...definition, inputSchema: { type: "object", properties: { nested: { type: "object", properties: {}, required: [], additionalProperties: false } }, required: [], additionalProperties: false }, execution: { ...execution, query: { sku: { input: "nested" } } } });
  bad(ResponseProcessingSchema, { kind: "LIST", fields: {}, filters: [], sort: null, limit: 1 });
  bad(ExternalResponseFormatSchema, { mode: "JSON", mediaTypes: ["application/json", "application/json"] });
});

test("X13 processing and connection DTO contracts remain strict and bounded", () => {
  ok(TransformSampleSchema, { status: 200, contentType: "text/plain; charset=utf-8", bodyText: "Stock: available" });
  bad(TransformSampleSchema, { status: 199, contentType: "text/plain", bodyText: "" });
  ok(ConnectionCommandSchema, { operationId: "op", reason: "Rotate key" });
  bad(ConnectionCommandSchema, { operationId: "op", reason: " " });
  ok(ConnectionViewSchema, {
    id: "connection", key: "catalogue", displayName: "Catalogue", description: "", enabled: true, editVersion: 1,
    revisions: [{ id: "revision", connectionId: "connection", revisionNumber: 1, origin: "https://example.test", scope: "PLATFORM", authMode: "NONE", authHeader: null, documentation: "", createdAt: "2026-09-21T00:00:00.000Z" }],
  });
});
