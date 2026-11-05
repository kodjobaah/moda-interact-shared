import { CommerceToolInputs, CommerceToolOutputs } from "./schemas.js";

/**
 * Canonical Shared mapping for the two published discount capabilities.
 * Consumers reuse these validators instead of maintaining local copies.
 * `operationVersion` is independent of immutable published tool definition
 * versions selected by Commerce during publication.
 */
export const DISCOUNT_POLICY_OPERATION_DESCRIPTORS = Object.freeze([
  Object.freeze({
    toolName: "commerce_get_discount_options",
    displayName: "Get Discount Options",
    operation: "discounts.getOptions",
    operationVersion: "1.0.0",
    description: "Read the configured discount mode and available offers.",
    inputValidator: CommerceToolInputs.commerce_get_discount_options,
    outputValidator: CommerceToolOutputs.commerce_get_discount_options,
  }),
  Object.freeze({
    toolName: "commerce_get_discount_details",
    displayName: "Get Discount Details",
    operation: "discounts.getDetails",
    operationVersion: "1.0.0",
    description: "Read details and condition facts for a permitted discount.",
    inputValidator: CommerceToolInputs.commerce_get_discount_details,
    outputValidator: CommerceToolOutputs.commerce_get_discount_details,
  }),
] as const);

export type DiscountPolicyOperationDescriptor =
  (typeof DISCOUNT_POLICY_OPERATION_DESCRIPTORS)[number];
