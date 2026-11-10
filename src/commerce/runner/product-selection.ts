import type { CommerceResponseContract } from '../response.js';
import type { CommerceRuntimeMessage } from './graph/state.js';

export const PRODUCT_SELECTION_FIELDS = ['productRecommendations', 'productDetailSelections', 'productOptionSelections'] as const;
/** Same current-turn product observation boundary for both production and preview hosts. */
export function hasObservedProducts(messages: readonly CommerceRuntimeMessage[]): boolean {
  return messages.some(message => {
    if (message.tool !== 'commerce_search_products' && message.tool !== 'commerce_get_product') return false;
    const result = message.result as {status?: string; data?: {products?: unknown[]; product?: unknown}} | null;
    return result?.status === 'OK' && (Boolean(result.data?.product) || Boolean(result.data?.products?.length));
  });
}
export function productSelectionFields(contract: CommerceResponseContract) {
  const properties = contract.detailsSchema.properties ?? {};
  return PRODUCT_SELECTION_FIELDS.filter(key => Object.hasOwn(properties, key));
}
/** Preserve the pinned contract; add a current-turn ANSWER constraint, never fabricated selections. */
export function productSelectionConstraint(contract: CommerceResponseContract) {
  const fields = productSelectionFields(contract);
  return { anyOf: [
    {properties: {answerKind: {const: 'REFER_TO_STORE'}}},
    {properties: {details: {anyOf: [
      ...fields.map(key => ({required: [key], properties: {[key]: {type: 'array', minItems: 1}}})),
      ...(Object.hasOwn(contract.detailsSchema.properties ?? {}, 'shippingInformationSelection') ? [{required: ['shippingInformationSelection']}] : []),
      ...(Object.hasOwn(contract.detailsSchema.properties ?? {}, 'responseDisposition') ? [{required: ['responseDisposition'], properties: {responseDisposition: {const: 'SHIPPING_INFORMATION_UNVERIFIED'}}}] : []),
    ]}}},
  ]};
}
