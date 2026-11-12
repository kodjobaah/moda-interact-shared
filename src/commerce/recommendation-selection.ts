import {
  CommerceAnswerPresentationSelectionSchema,
  CommerceProductRecommendationSelectionSchema,
  CommerceShippingInformationSchema,
  type CommerceAnswerPresentationSelection,
  type CommerceProductRecommendationSelection,
} from "./schemas.js";
import type { CommerceResponseContract } from "./response.js";
import { normalizeCommerceProductSelections } from "./selection.js";

export type CommerceRecommendationSelection = Readonly<{
  productRecommendationVersion?: "1";
  productRecommendations?: readonly NonNullable<CommerceProductRecommendationSelection["productRecommendations"]>[number][];
  responseDisposition?: "STANDARD" | "OUT_OF_SCOPE_REDIRECT" | "SHIPPING_INFORMATION_UNVERIFIED";
  shippingInformationSelection?: Readonly<NonNullable<CommerceAnswerPresentationSelection["shippingInformationSelection"]>>;
}>;

/** Parse host-composable intent; this never authorizes or selects products. */
export function readCommerceRecommendationSelection(raw: Record<string, unknown>): CommerceRecommendationSelection | null {
  const details = normalizeCommerceProductSelections(raw);
  const recommendation = CommerceProductRecommendationSelectionSchema.safeParse({
    ...(Object.hasOwn(details, "productRecommendationVersion") ? { productRecommendationVersion: details.productRecommendationVersion } : {}),
    ...(Object.hasOwn(details, "productRecommendations") ? { productRecommendations: details.productRecommendations } : {}),
  });
  const presentation = CommerceAnswerPresentationSelectionSchema.safeParse({
    ...(Object.hasOwn(details, "responseDisposition") ? { responseDisposition: details.responseDisposition } : {}),
    ...(Object.hasOwn(details, "shippingInformationSelection") ? { shippingInformationSelection: details.shippingInformationSelection } : {}),
  });
  const recommendationData = recommendation.success ? recommendation.data : null;
  const hasVersion = recommendationData?.productRecommendationVersion !== undefined;
  const hasProducts = recommendationData?.productRecommendations !== undefined;
  const recommendationsValid = recommendationData !== null && hasVersion === hasProducts;
  const parsedDisposition = presentation.success
    ? presentation.data.responseDisposition
    : CommerceAnswerPresentationSelectionSchema.safeParse({ responseDisposition: details.responseDisposition }).success
      ? details.responseDisposition as CommerceAnswerPresentationSelection["responseDisposition"] : undefined;
  // Fact dispositions remain owned by fresh fact-presentation verification.
  const disposition = parsedDisposition === "STANDARD" || parsedDisposition === "OUT_OF_SCOPE_REDIRECT" || parsedDisposition === "SHIPPING_INFORMATION_UNVERIFIED"
    ? parsedDisposition : undefined;
  const shippingSelection = presentation.success
    ? presentation.data.shippingInformationSelection
    : CommerceAnswerPresentationSelectionSchema.safeParse({ shippingInformationSelection: details.shippingInformationSelection }).success
      ? details.shippingInformationSelection as CommerceAnswerPresentationSelection["shippingInformationSelection"] : undefined;
  const validShipping = shippingSelection && disposition &&
    (!shippingSelection.variantId || Boolean(shippingSelection.productId)) ? shippingSelection : undefined;
  if (!recommendationsValid && disposition === undefined && validShipping === undefined) return null;
  return Object.freeze({
    ...(recommendationsValid && recommendationData.productRecommendationVersion !== undefined ? { productRecommendationVersion: recommendationData.productRecommendationVersion } : {}),
    ...(recommendationsValid && recommendationData.productRecommendations !== undefined ? { productRecommendations: recommendationData.productRecommendations } : {}),
    ...(disposition === undefined ? {} : { responseDisposition: disposition }),
    ...(validShipping === undefined ? {} : { shippingInformationSelection: validShipping }),
  });
}

/** Legacy/custom pinned contracts may not expose canonical version/list fields. */
export function hasCanonicalCommerceRecommendationContract(contract: CommerceResponseContract): boolean {
  const properties = contract.detailsSchema.properties ?? {};
  return Object.hasOwn(properties, "productRecommendationVersion") && Object.hasOwn(properties, "productRecommendations");
}

/** Match verified shipping DTO identity; an unavailable policy may still be a truthful limitation. */
export function isCommerceShippingObservationForSelection(input: {
  selection: Readonly<{ productId: string | null; variantId: string | null }>;
  observation: unknown;
  provider?: "SHOPIFY" | "WOOCOMMERCE";
}): boolean {
  const parsed = CommerceShippingInformationSchema.safeParse(input.observation);
  if (!parsed.success || (input.provider !== undefined && parsed.data.provider !== input.provider)) return false;
  const product = parsed.data.product;
  if (input.selection.variantId !== null && input.selection.productId === null) return false;
  if (product.productId !== input.selection.productId || product.variantId !== input.selection.variantId) return false;
  return input.selection.productId === null
    ? product.status === "NOT_REQUESTED" && product.variantId === null
    : product.status !== "NOT_REQUESTED";
}

/** Input observations must come from authorized current-turn tool execution, never history or prose. */
export function readCommerceObservedShippingSelections(
  messages: readonly Readonly<{ tool: string; result: unknown }>[],
  provider?: "SHOPIFY" | "WOOCOMMERCE",
): readonly Readonly<{ productId: string | null; variantId: string | null }>[] {
  const selections = new Map<string, Readonly<{ productId: string | null; variantId: string | null }>>();
  for (const message of messages) {
    if (message.tool !== "commerce_get_shipping_information" || !message.result || typeof message.result !== "object") continue;
    const result = message.result as { status?: unknown; data?: unknown };
    if (result.status !== "OK") continue;
    const parsed = CommerceShippingInformationSchema.safeParse(result.data);
    if (!parsed.success) continue;
    const selection = { productId: parsed.data.product.productId, variantId: parsed.data.product.variantId };
    if (isCommerceShippingObservationForSelection({ selection, observation: parsed.data, provider }))
      selections.set(JSON.stringify([selection.productId, selection.variantId]), Object.freeze(selection));
  }
  return Object.freeze([...selections.values()]);
}

/** Whether a parsed answer has host-composable intent under its pinned contract. */
export function hasCommerceAcceptedProductSelection(
  raw: Record<string, unknown>, contract: CommerceResponseContract,
  messages: readonly Readonly<{ tool: string; result: unknown }>[] = [],
  provider?: "SHOPIFY" | "WOOCOMMERCE",
): boolean {
  const details = normalizeCommerceProductSelections(raw);
  const nonempty = (field: string) => Array.isArray(details[field]) && details[field].length > 0;
  if (!hasCanonicalCommerceRecommendationContract(contract)) {
    return ["productRecommendations", "productDetailSelections", "productOptionSelections"].some(nonempty) ||
      details.responseDisposition === "SHIPPING_INFORMATION_UNVERIFIED" || Boolean(details.shippingInformationSelection);
  }
  const selection = readCommerceRecommendationSelection(details);
  if (selection?.productRecommendations?.length || ["productDetailSelections", "productOptionSelections"].some(nonempty)) return true;
  const shipping = selection?.shippingInformationSelection ??
    (selection?.responseDisposition === "SHIPPING_INFORMATION_UNVERIFIED" ? { productId: null, variantId: null } : null);
  return shipping !== null && readCommerceObservedShippingSelections(messages, provider).some(observed =>
    observed.productId === shipping.productId && observed.variantId === shipping.variantId);
}
