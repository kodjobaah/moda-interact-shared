import { z } from "zod";
import { canonicalJson } from "./canonical-json";
import { CommerceToolOutputs } from "./schemas";
import type { CommerceBuiltInToolDescriptor, CommerceBuiltInToolGrant } from "./definitions";

function immutable<T extends object>(value: T): T {
  for (const child of Object.values(value))
    if (child && typeof child === "object") immutable(child);
  return Object.freeze(value);
}

/** Code-owned descriptors. Hashes are generated and verified against the exact wire schemas. */
export const commerceDiscountBuiltInDescriptors: readonly CommerceBuiltInToolDescriptor[] = immutable<CommerceBuiltInToolDescriptor[]>([
  {
    kind: "BUILT_IN", name: "commerce_get_discount_options", definitionVersion: "1.0.0",
    contractHash: "a0a4a88c7920a25a31657a03761b6556419189aeab251261a58e2dfb83a3bdcb",
    description: "Read the current shop's permitted discount options.",
    inputSchema: {
      type: "object", properties: {
        limit: {type: "integer", minimum: 1, maximum: 50},
        cursor: {type: ["string", "null"], maxLength: 2048},
      }, additionalProperties: false,
    },
  },
  {
    kind: "BUILT_IN", name: "commerce_get_discount_details", definitionVersion: "1.0.0",
    contractHash: "776f6bc6ac1800c75744c2ffa7357f07a32be2b61309b1d71abf0493a2de316f",
    description: "Read details for a permitted discount in the current shop.",
    inputSchema: {
      type: "object", properties: {offerId: {type: "string", minLength: 1, maxLength: 128}},
      required: ["offerId"], additionalProperties: false,
    },
  },
]);

/** Portable canonical bytes; callers inject hashing in their trusted Node adapter. */
export function commerceBuiltInToolContractPayload(descriptor: CommerceBuiltInToolDescriptor): string {
  return canonicalJson({
    name: descriptor.name, definitionVersion: descriptor.definitionVersion,
    description: descriptor.description, inputSchema: descriptor.inputSchema,
    outputSchema: z.toJSONSchema(CommerceToolOutputs[descriptor.name], {io: "output", unrepresentable: "any"}),
  });
}
export function isTrustedCommerceBuiltInDescriptor(value: CommerceBuiltInToolDescriptor): boolean {
  return commerceDiscountBuiltInDescriptors.some(expected => canonicalJson(expected) === canonicalJson(value));
}
export function isTrustedCommerceBuiltInGrant(value: CommerceBuiltInToolGrant): boolean {
  return commerceDiscountBuiltInDescriptors.some(expected =>
    value.toolName === expected.name && value.definitionVersion === expected.definitionVersion &&
    value.contractHash === expected.contractHash);
}
