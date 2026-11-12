import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_RESPONSE_CONTRACT, finalResponseSchema, type CommerceResponseContract } from "../response.js";
import { initialCommerceTurnGraphState } from "./graph/state.js";
import { validateFinalResponseNode } from "./graph/nodes/validate-final-response.js";

const id = { type: "string", minLength: 1, maxLength: 128 };
const nullableId = { ...id, type: ["string", "null"] as [string, "null"] };
const recommendation = { scope: "PRODUCT_ONLY", basketLineId: null, productId: "observed-product", variantId: null,
  quantity: 1, promotionKind: "NONE", offerIds: [] };
const response = { ...EMPTY_RESPONSE_CONTRACT, detailsSchema: { type: "object", required: [], additionalProperties: false, properties: {
  productRecommendationVersion: { type: "string", enum: ["1"], maxLength: 1 },
  productRecommendations: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false,
    required: Object.keys(recommendation), properties: { scope: { type: "string", enum: ["PRODUCT_ONLY", "ADD_TO_BASKET", "REPLACE_BASKET_LINE"], maxLength: 19 }, basketLineId: nullableId, productId: id, variantId: nullableId, quantity: { type: "integer", minimum: 1, maximum: 99 }, promotionKind: { type: "string", enum: ["NONE", "NATIVE_SALE", "DISCOUNT"], maxLength: 11 }, offerIds: { type: "array", maxItems: 3, items: id } } } },
  responseDisposition: { type: "string", enum: ["STANDARD", "OUT_OF_SCOPE_REDIRECT", "SHIPPING_INFORMATION_UNVERIFIED"], maxLength: 31 },
  shippingInformationSelection: { type: "object", additionalProperties: false, required: ["productId", "variantId"], properties: { productId: nullableId, variantId: nullableId } },
} } } as CommerceResponseContract;
function fixture(details: Record<string, unknown>) {
  const execution = { prepared: { response, finalSchema: finalResponseSchema(response), budgets: { remoteCalls: 9 } },
    input: { language: { tag: "en", source: "merchant-default" }, dependencies: { now: () => 0 } },
    runtime: { checkCancellationAndDeadline() {} }, logger: {} } as unknown as Parameters<typeof validateFinalResponseNode>[0];
  const state = { ...initialCommerceTurnGraphState(), modelSteps: 3,
    runtimeMessages: [{ tool: "commerce_search_products", result: { status: "OK", data: { products: [{ productId: "observed-product", variantId: null }] } } }],
    pendingStep: { calls: [{ name: "finalResponse", arguments: { answerKind: "ANSWER", replyText: "Synthetic supported reply", referralReason: null,
      detectedLanguageTag: null, detectedLanguageConfidence: null, evidenceIds: [], details } }], outputTokens: 50 } };
  return { execution, state, node: validateFinalResponseNode(execution) };
}
for (const [name, details] of [
  ["nonempty recommendations missing their version", { responseDisposition: "STANDARD", productRecommendations: [recommendation] }],
  ["shipping placeholder without disposition", { shippingInformationSelection: { productId: null, variantId: null } }],
] as const) test(`existing bounded correction catches ${name}`, async () => {
  const { node, state } = fixture(details);
  const result = await node(state);
  assert.equal(result.selectionRepairUsed, true);
  assert.equal(result.finalResult, null);
  await assert.rejects(node({ ...state, selectionRepairUsed: true }), error => (error as { diagnostic: { reasonCode: string } }).diagnostic.reasonCode === "FINAL_PRODUCT_SELECTION_MISSING");
});

test("one existing forced finalization accepts the model's corrected paired selection", async () => {
  const { invokeModelNode } = await import("./graph/nodes/invoke-model.js");
  const { node, state, execution } = fixture({ responseDisposition: "STANDARD", productRecommendations: [recommendation] });
  const correction = await node(state);
  const requests: Array<{ requiredToolName?: string; tools: readonly { name: string; inputSchema: unknown }[] }> = [];
  Object.assign(execution.prepared, { instructions: [], budgets: { remoteCalls: 9, modelSteps: 4, outputTokens: 100, deadlineMs: 1000 } });
  Object.assign(execution.input, { signal: new AbortController().signal, context: {}, history: [] });
  Object.assign(execution.input.dependencies, { model: { invoke: async (request: typeof requests[number]) => {
    requests.push(request);
    return { ...state.pendingStep, calls: [{ name: "finalResponse", arguments: { ...state.pendingStep.calls[0].arguments, details: { productRecommendationVersion: "1", productRecommendations: [recommendation] } } }] };
  } } });
  Object.assign(execution.runtime, { bounded: async (fn: (signal: AbortSignal) => Promise<unknown>) => fn(execution.input.signal) });
  Object.assign(execution, { stats: { modelSteps: 3, remoteCalls: 0 } });
  const repaired = await invokeModelNode(execution)({ ...state, ...correction });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requiredToolName, "finalResponse");
  assert.deepEqual(requests[0].tools.map(tool => tool.name), ["finalResponse"]);
  const result = await node({ ...state, ...correction, ...repaired });
  assert.deepEqual(result.finalResult?.details.productRecommendations, [recommendation]);
});
test("canonical shipping placeholders and dispositions cannot bypass observed-product repair", async () => {
  for (const details of [{ responseDisposition: "STANDARD", shippingInformationSelection: { productId: null, variantId: null } }, { responseDisposition: "SHIPPING_INFORMATION_UNVERIFIED" }]) {
    const { node, state } = fixture(details);
    assert.equal((await node(state)).selectionRepairUsed, true);
  }
});
test("empty search and ordinary answers retain existing behavior without product claims", async () => {
  const { node, state } = fixture({ responseDisposition: "STANDARD" });
  for (const runtimeMessages of [[], [{ tool: "commerce_search_products", result: { status: "OK", data: { products: [] } } }]]) {
    const result = await node({ ...state, runtimeMessages });
    assert.ok(result.finalResult);
    assert.equal(result.selectionRepairUsed, undefined);
  }
});
test("a required format correction cannot exceed the existing model-step budget", async () => {
  const { resolveAvailableToolsNode } = await import("./graph/nodes/resolve-available-tools.js");
  const { execution, state } = fixture({ responseDisposition: "STANDARD" });
  Object.assign(execution.prepared.budgets, { modelSteps: 3 });
  await assert.rejects(resolveAvailableToolsNode(execution)({ ...state, selectionRepairUsed: true }), error => (error as { code: string }).code === "BUDGET_EXHAUSTED");
});

test("matched authorized policy-only shipping remains a valid answer and mismatches repair", async () => {
  const { node, state, execution } = fixture({ responseDisposition: "STANDARD", shippingInformationSelection: { productId: null, variantId: null } });
  execution.input.platform = "SHOPIFY";
  const output = { provider: "SHOPIFY", observedAt: "2026-11-12T00:00:00Z", product: { status: "NOT_REQUESTED", productId: null, variantId: null, requiresShipping: null, virtual: null, weight: null, dimensions: null, shippingClassId: null, shippingClassSlug: null }, policy: { status: "SCOPE_NOT_GRANTED", trust: "UNTRUSTED_REFERENCE", title: null, bodyStatus: "NOT_AVAILABLE", bodyHtml: null, url: null, updatedAt: null } };
  const observed = (data: unknown) => [...state.runtimeMessages, { tool: "commerce_get_shipping_information", result: { status: "OK", data } }];
  assert.ok((await node({ ...state, runtimeMessages: observed(output) })).finalResult);
  assert.equal((await node({ ...state, runtimeMessages: observed({ ...output, provider: "WOOCOMMERCE" }) })).selectionRepairUsed, true);
  assert.equal((await node({ ...state, runtimeMessages: observed({ ...output, product: { ...output.product, productId: "other", status: "AVAILABLE" } }) })).selectionRepairUsed, true);
});
test("forced schema requires supported version pairs and only observed shipping alternatives", async () => {
  const { productSelectionConstraint } = await import("./product-selection.js");
  const noShipping = productSelectionConstraint(response);
  const choices = noShipping.anyOf[1].properties!.details!.anyOf;
  assert.deepEqual(choices[0].required, ["productRecommendations", "productRecommendationVersion"]);
  assert.equal(JSON.stringify(noShipping).includes("shippingInformationSelection"), false);
  assert.equal(JSON.stringify(noShipping).includes("SHIPPING_INFORMATION_UNVERIFIED"), false);
  const legacy = { ...response, detailsSchema: { ...response.detailsSchema, properties: { productRecommendations: response.detailsSchema.properties!.productRecommendations } } };
  assert.equal(JSON.stringify(productSelectionConstraint(legacy)).includes("productRecommendationVersion"), false);
});

test("historical shipping text is not current-turn shipping evidence", async () => {
  const { node, state, execution } = fixture({ responseDisposition: "STANDARD", shippingInformationSelection: { productId: null, variantId: null } });
  Object.assign(execution.input, { context: { priorShipping: { productId: null, variantId: null } }, history: [{ role: "assistant", text: "Previous shipping policy was available." }] });
  assert.equal((await node(state)).selectionRepairUsed, true);
});
test("cancellation remains terminal during semantic correction without model work", async () => {
  const { RunnerFailure } = await import("./failure.js");
  const { invokeModelNode } = await import("./graph/nodes/invoke-model.js");
  const { execution, state } = fixture({ responseDisposition: "STANDARD" });
  execution.runtime.checkCancellationAndDeadline = () => { throw new RunnerFailure("CANCELLED", { stage: "runtime.cancellation", reasonCode: "CANCELLED_BY_CALLER" }); };
  await assert.rejects(invokeModelNode(execution)({ ...state, selectionRepairUsed: true }), error => (error as { code: string }).code === "CANCELLED");
});

test("observed generic policy constrains any explicit shipping placeholder to its exact identity", async () => {
  const { productSelectionConstraint } = await import("./product-selection.js");
  const policy = { provider: "SHOPIFY", observedAt: "2026-11-12T00:00:00Z", product: { status: "NOT_REQUESTED", productId: null, variantId: null, requiresShipping: null, virtual: null, weight: null, dimensions: null, shippingClassId: null, shippingClassSlug: null }, policy: { status: "NOT_CONFIGURED", trust: "UNTRUSTED_REFERENCE", title: null, bodyStatus: "NOT_AVAILABLE", bodyHtml: null, url: null, updatedAt: null } };
  const constraint = productSelectionConstraint(response, [{ tool: "commerce_get_shipping_information", result: { status: "OK", data: policy } }], "SHOPIFY");
  const choices = constraint.anyOf[1].properties!.details!.anyOf as Array<{ required: string[]; properties?: Record<string, unknown> }>;
  const disposition = choices.find(choice => {
    const rule = choice.properties?.responseDisposition;
    return rule !== null && typeof rule === "object" && "const" in rule;
  });
  assert.deepEqual(disposition?.properties?.shippingInformationSelection, { properties: { productId: { const: null }, variantId: { const: null } } });
  const selectedShipping = choices.find(choice => choice.required.includes("shippingInformationSelection"));
  assert.deepEqual(selectedShipping?.properties?.shippingInformationSelection, { anyOf: [{ properties: { productId: { const: null }, variantId: { const: null } } }] });
});

async function forcedEnvelope(referralReason: unknown, answerKind: "ANSWER" | "REFER_TO_STORE" = "ANSWER", omitted = false) {
  const { invokeModelNode } = await import("./graph/nodes/invoke-model.js");
  const { node, state, execution } = fixture({ responseDisposition: "STANDARD", productRecommendations: [recommendation] });
  const correction = await node(state);
  const requests: Array<{ requiredToolName?: string; instructions: readonly string[]; tools: readonly { name: string }[] }> = [];
  const args: Record<string, unknown> = { ...state.pendingStep.calls[0].arguments, answerKind, referralReason,
    details: answerKind === "ANSWER" ? { productRecommendationVersion: "1", productRecommendations: [recommendation] } : {} };
  if (omitted) delete args.referralReason;
  Object.assign(execution.prepared, { instructions: [], budgets: { remoteCalls: 9, modelSteps: 4, outputTokens: 100, deadlineMs: 1000 } });
  Object.assign(execution.input, { signal: new AbortController().signal, context: {}, history: [] });
  Object.assign(execution.input.dependencies, { model: { invoke: async (request: typeof requests[number]) => { requests.push(request); return { ...state.pendingStep, calls: [{ name: "finalResponse", arguments: args }] }; } } });
  Object.assign(execution.runtime, { bounded: async (fn: (signal: AbortSignal) => Promise<unknown>) => fn(execution.input.signal) });
  Object.assign(execution, { stats: { modelSteps: 3, remoteCalls: 0 } });
  return { requests, args, complete: async () => {
    const repaired = await invokeModelNode(execution)({ ...state, ...correction });
    return node({ ...state, ...correction, ...repaired });
  } };
}
test("one product-selection correction accepts an actual JSON-null ANSWER envelope", async () => {
  const f = await forcedEnvelope(null);
  const result = await f.complete();
  assert.equal(result.finalResult?.referralReason, null);
  assert.deepEqual(result.finalResult?.details.productRecommendations, [recommendation]);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0]!.tools.map(tool => tool.name), ["finalResponse"]);
  assert.ok(f.requests[0]!.instructions.some(text => text.includes("ANSWER") && text.includes("JSON null") && text.includes("REFER_TO_STORE")));
});
test("allowed referrals remain valid during product-selection correction", async () => {
  const { ReferralReasonSchema } = await import("../response.js");
  for (const reason of ReferralReasonSchema.options) {
    const f = await forcedEnvelope(reason, "REFER_TO_STORE");
    assert.equal((await f.complete()).finalResult?.referralReason, reason);
    assert.equal(f.requests.length, 1);
  }
});
test("malformed or omitted referral reasons terminate after the existing correction without coercion", async () => {
  for (const reason of ["null", "NONE", "", "UNKNOWN_REASON", undefined, false, 0, "TOOL_UNAVAILABLE"]) {
    const f = await forcedEnvelope(reason, "ANSWER", reason === undefined);
    await assert.rejects(f.complete(), error => {
      const failure = error as { code: string; diagnostic: { reasonCode: string; issuePaths?: readonly string[] } };
      assert.equal(failure.code, "INVALID_FINAL");
      assert.equal(failure.diagnostic.reasonCode, "FINAL_SCHEMA_INVALID");
      assert.ok(failure.diagnostic.issuePaths?.includes("referralReason"));
      return true;
    });
    assert.equal(f.requests.length, 1);
    assert.equal(f.args.referralReason, reason);
  }
});
