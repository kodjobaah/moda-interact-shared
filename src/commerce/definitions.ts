import { z } from "zod";
import { gt } from "semver";
import {
  boundedJson,
  ContractVersionSchema,
  IdSchema,
  SemverSchema,
  HashSchema,
  distinct,
} from "./primitives";
import {
  InputSchemaSchema,
  safeName,
  safePath,
  type SubsetSchema,
  compileSubset,
} from "./subset";
import { canonicalJson } from "./canonical-json";
export const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,127}$/)
  .refine((n) => n !== "finalResponse");
export const ToolBindingSchema = z.strictObject({
  toolId: IdSchema,
  toolRevisionId: IdSchema,
});
export const ToolBindingsSchema = z
  .array(ToolBindingSchema)
  .max(32)
  .refine((v) => distinct(v.map((x) => x.toolId)));
export const GrantedToolSchema = z.strictObject({
  toolId: IdSchema,
  toolRevisionId: IdSchema,
  toolName: ToolNameSchema,
  definitionVersion: SemverSchema,
  capabilityKeys: z
    .array(IdSchema)
    .min(1)
    .max(32)
    .refine((v) => distinct(v) && v.join("\0") === [...v].sort().join("\0")),
});
export const GrantedToolsSchema = z
  .array(GrantedToolSchema)
  .max(32)
  .refine(
    (v) =>
      distinct(v.map((x) => x.toolId)) && distinct(v.map((x) => x.toolName)),
  );
export const ToolDescriptorSchema = z.strictObject({
  toolId: IdSchema,
  toolRevisionId: IdSchema,
  name: ToolNameSchema,
  definitionVersion: SemverSchema,
  description: z.string().min(1).max(4096),
  inputSchema: InputSchemaSchema,
});
const MappingSchema = z.union([
  z.strictObject({
    input: z.string().refine(safeName),
    omitIfMissing: z.literal(true).optional(),
  }),
  z.strictObject({ literal: boundedJson(8192) }),
]);
const MappingsSchema = z
  .record(z.string().refine(safeName), MappingSchema)
  .refine((v) => Object.keys(v).length <= 32);
export const POLICY_OPERATIONS = [
  "recovery.getBasket",
  "shopify.searchProducts",
  "discounts.getOptions",
  "discounts.evaluate",
  "products.findQualifying",
  "products.findSimilar",
] as const;
export const CommerceExecutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SHOPIFY_STOREFRONT_QUERY"),
    executorVersion: z.literal("1.0.0"),
    apiVersion: z.literal("2026-07"),
    schemaHash: HashSchema,
    document: z
      .string()
      .min(1)
      .refine((v) => new TextEncoder().encode(v).length <= 16384),
    operationName: z.string().refine(safeName),
    variables: MappingsSchema,
    resultPath: z.string().refine(safePath),
  }),
  z.strictObject({
    kind: z.literal("POLICY_OPERATION"),
    operation: z.enum(POLICY_OPERATIONS),
    operationVersion: z.literal("1.0.0"),
    arguments: MappingsSchema,
  }),
]);
function tokensValid(text: string, root: "result" | "item") {
  if (/[<>]/.test(text)) return false;
  const residue = text.replace(/\{\{([^{}]+)\}\}/g, (_all, path: string) =>
    path.startsWith(root + ".") && safePath(path.slice(root.length + 1))
      ? ""
      : "{{invalid}}",
  );
  return !residue.includes("{{") && !residue.includes("}}");
}
const fixed = z
  .string()
  .max(4096)
  .refine((v) => !/[<>]|\{\{|\}\}/.test(v));
export const ResponseTemplateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    text: z
      .string()
      .max(4096)
      .refine((v) => tokensValid(v, "result")),
    unavailable: fixed,
  }),
  z.strictObject({
    kind: z.literal("items"),
    itemsPath: z.string().refine(safePath),
    item: z
      .string()
      .max(4096)
      .refine((v) => tokensValid(v, "item")),
    empty: fixed,
    unavailable: fixed,
  }),
]);
const identity = {
  name: ToolNameSchema,
  definitionVersion: SemverSchema,
  description: z.string().min(1).max(4096),
};
const forbiddenInput =
  /^(shopid|customerid|checkoutrecoveryid|conversationid|grantid|releaseid|token|accesstoken|domain|headers|url|graphql|document|authorization)$/i;
export const CommerceToolDefinitionSchema = z
  .strictObject({
    ...identity,
    inputSchema: InputSchemaSchema,
    execution: CommerceExecutionSchema,
    responseTemplate: ResponseTemplateSchema,
  })
  .superRefine((d, ctx) => {
    const properties = d.inputSchema.properties!;
    const containsAuthority = (schema: SubsetSchema): boolean =>
      Object.entries(schema.properties ?? {}).some(
        ([name, child]) =>
          forbiddenInput.test(name) || containsAuthority(child),
      ) || !!(schema.items && containsAuthority(schema.items));
    if (containsAuthority(d.inputSchema))
      ctx.addIssue({
        code: "custom",
        message: "Authority/credential inputs are forbidden",
      });
    const mapping =
      d.execution.kind === "POLICY_OPERATION"
        ? d.execution.arguments
        : d.execution.variables;
    for (const [name, m] of Object.entries(mapping))
      if ("input" in m && !Object.hasOwn(properties, m.input))
        ctx.addIssue({
          code: "custom",
          path: ["execution", name],
          message: "Unknown mapped input",
        });
  });
const draftObject = boundedJson(65536).refine(
  (v) => !!v && typeof v === "object" && !Array.isArray(v),
);
export const CommerceToolDraftDefinitionSchema = z
  .strictObject({
    ...identity,
    inputSchema: draftObject,
    execution: draftObject,
    responseTemplate: draftObject,
  })
  .refine((v) => new TextEncoder().encode(canonicalJson(v)).length <= 131072);
export type CommerceToolDefinition = z.infer<
  typeof CommerceToolDefinitionSchema
>;
export type CommerceToolDraftDefinition = z.infer<
  typeof CommerceToolDraftDefinitionSchema
>;
export type GrantedTool = z.infer<typeof GrantedToolSchema>;
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;
/** Commerce owns schema-backed GraphQL parsing, restrictions and output derivation. */
export interface CommerceDefinitionCompiler {
  compile(
    execution: CommerceToolDefinition["execution"],
    input: SubsetSchema,
  ): {
    outputSchema: SubsetSchema;
    validateMappedArguments: (
      mapping: CommerceToolDefinition["execution"],
    ) => boolean;
  };
}
function at(schema: SubsetSchema, path: string) {
  let current: SubsetSchema | undefined = schema;
  for (const part of path.split(".")) current = current?.properties?.[part];
  return current;
}
export function validateDefinitionForPublication(
  raw: unknown,
  compiler: CommerceDefinitionCompiler,
) {
  const definition = CommerceToolDefinitionSchema.parse(raw);
  const compiled = compiler.compile(
    definition.execution,
    definition.inputSchema,
  );
  if (!compiled.validateMappedArguments(definition.execution))
    throw new TypeError("Invalid variable/operation mapping");
  const template = definition.responseTemplate;
  const schema =
    template.kind === "text"
      ? compiled.outputSchema
      : at(compiled.outputSchema, template.itemsPath)?.items;
  if (!schema) throw new TypeError("Unknown template items path");
  const text = template.kind === "text" ? template.text : template.item;
  for (const match of text.matchAll(/\{\{(?:result|item)\.([^{}]+)\}\}/g)) {
    const target = at(schema, match[1]);
    const type =
      target && (Array.isArray(target.type) ? target.type[0] : target.type);
    if (!type || ["object", "array"].includes(type))
      throw new TypeError("Unknown or nonscalar template path");
  }
  return definition;
}
export function definitionToMcpDescriptor(definition: CommerceToolDefinition) {
  const d = CommerceToolDefinitionSchema.parse(definition);
  return {
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
  };
}
export function mapToolArguments(
  definition: CommerceToolDefinition,
  raw: unknown,
) {
  const input = compileSubset(definition.inputSchema, "input").parse(raw);
  const mapping =
    definition.execution.kind === "POLICY_OPERATION"
      ? definition.execution.arguments
      : definition.execution.variables;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, m] of Object.entries(mapping)) {
    if ("literal" in m) result[key] = m.literal;
    else if (Object.hasOwn(input, m.input)) result[key] = input[m.input];
    else if (!m.omitIfMissing) throw new TypeError("Missing mapped input");
  }
  return result;
}
export const toolHashInput = (definition: CommerceToolDefinition) => ({
  contractVersion: ContractVersionSchema.value,
  definition: CommerceToolDefinitionSchema.parse(definition),
});
export function capabilityHashInput(
  promptTemplate: string,
  configuration: unknown,
  toolBindings: unknown,
) {
  if (!promptTemplate.trim() || promptTemplate.length > 32000)
    throw new TypeError("Invalid capability prompt");
  return {
    contractVersion: ContractVersionSchema.value,
    promptTemplate,
    configuration,
    toolBindings: ToolBindingsSchema.parse(toolBindings).sort((a, b) =>
      a.toolId < b.toolId ? -1 : 1,
    ),
  };
}

/** Publication adapters supply the actual highest published version from persistence. */
export function validateDefinitionVersion(
  proposed: string,
  highestPublished: string | null,
) {
  SemverSchema.parse(proposed);
  if (highestPublished === null) return proposed === "1.0.0";
  SemverSchema.parse(highestPublished);
  return gt(proposed, highestPublished);
}
export const CommerceToolIdentitySchema = z.strictObject({
  id: IdSchema,
  name: ToolNameSchema,
  enabled: z.boolean(),
});
export const CommerceToolRevisionIdentitySchema = z.strictObject({
  toolId: IdSchema,
  toolRevisionId: IdSchema,
  definitionVersion: SemverSchema,
  contentHash: HashSchema,
});
export const POLICY_OPERATION_DESCRIPTORS = POLICY_OPERATIONS.map(
  (operation) => ({ operation, operationVersion: "1.0.0" as const }),
);
