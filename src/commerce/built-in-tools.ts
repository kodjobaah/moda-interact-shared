import { canonicalJson } from "./canonical-json";
import type { CommerceBuiltInToolDescriptor, CommerceBuiltInToolGrant } from "./definitions";

function immutable<T extends object>(value: T): T {
  for (const child of Object.values(value))
    if (child && typeof child === "object") immutable(child);
  return Object.freeze(value);
}

/** Code-owned descriptors with stable name/version identities. */
export const commerceDiscountBuiltInDescriptors: readonly CommerceBuiltInToolDescriptor[] = immutable<CommerceBuiltInToolDescriptor[]>([
  {
    kind: "BUILT_IN", name: "commerce_get_discount_options", definitionVersion: "1.0.0",
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
    description: "Read details for a permitted discount in the current shop.",
    inputSchema: {
      type: "object", properties: {offerId: {type: "string", minLength: 1, maxLength: 128}},
      required: ["offerId"], additionalProperties: false,
    },
  },
]);

export function isTrustedCommerceBuiltInDescriptor(value: CommerceBuiltInToolDescriptor): boolean {
  return commerceDiscountBuiltInDescriptors.some(expected => canonicalJson(expected) === canonicalJson(value));
}
export function isTrustedCommerceBuiltInGrant(value: CommerceBuiltInToolGrant): boolean {
  return commerceDiscountBuiltInDescriptors.some(expected =>
    value.toolName === expected.name && value.definitionVersion === expected.definitionVersion);
}
