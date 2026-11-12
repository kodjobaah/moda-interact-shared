import { hasCanonicalCommerceRecommendationContract } from "../../../recommendation-selection.js";
import { hasObservedProducts, productSelectionConstraint, productSelectionFields } from "../../product-selection.js";
import { finalResponseToolSchema, ReferralReasonSchema } from "../../../response.js";
import { RunnerFailure } from "../../failure.js";
import { elapsedDuration, logModelCompleted, logModelInvalid, logModelStarted } from "../../observability.js";
import { validateModelStep, routeModelStep } from "../../model-step.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";
import type { ModelStep } from "../../types.js";

const FORCED_FINAL_RESPONSE_ENVELOPE_INSTRUCTION =
  `Return every required finalResponse envelope field. For ANSWER, referralReason must be JSON null, not the string "null", "NONE", an empty string or an omitted field. For REFER_TO_STORE, referralReason must be exactly one allowed reason: ${ReferralReasonSchema.options.join(", ")}; evidenceIds must be [] and details must be {}. Preserve mandatory referral decisions. Never invent a reason or substitute another value for JSON null.`;

export function invokeModelNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue) => {
    execution.runtime.checkCancellationAndDeadline();
    const modelStep = state.modelSteps + 1;
    execution.stats.modelSteps = modelStep;
    const startedAt = execution.input.dependencies.now();
    logModelStarted(execution.logger, { modelStep, availableToolCount: state.availableTools.length });
    const selectionRequired = productSelectionFields(execution.prepared.response).length > 0 && hasObservedProducts(state.runtimeMessages) && !state.requiredReferral;
    const baseFinalSchema = finalResponseToolSchema(execution.prepared.response);
    const finalSchema = selectionRequired
      ? {...baseFinalSchema, allOf: [...baseFinalSchema.allOf, productSelectionConstraint(execution.prepared.response, state.runtimeMessages, execution.input.platform)]}
      : baseFinalSchema;
    const selectionInstruction = selectionRequired ? ["Current-turn product results are available. An ANSWER presenting these products must include at least one exact observed identity in the pinned productRecommendations, productDetailSelections or productOptionSelections fields. Select the field matching the customer request. For stock questions use productDetailSelections, including when stock.status is NOT_TRACKED or UNAVAILABLE: these are valid observed limitations, not a missing product. Never invent a quantity or repeat a successful lookup to obtain an untracked count. Empty details cannot be composed into a verified product reply. Shipping-only answers may instead use the pinned shipping selection or SHIPPING_INFORMATION_UNVERIFIED disposition. Do not repeat provider searches to construct selections; use the results already supplied.", ...(hasCanonicalCommerceRecommendationContract(execution.prepared.response) ? ["Supply the canonical recommendation version and selected product list together. Shipping-only alternatives, including SHIPPING_INFORMATION_UNVERIFIED, require matching successful current-turn shipping information for the selected product/variant or generic policy identity. A null/null placeholder without that observation cannot replace product selections."] : [])] : [];
    let raw: unknown;
    try {
      raw = await execution.runtime.bounded((signal) => execution.input.dependencies.model.invoke({
        ...(state.selectionRepairUsed ? { requiredToolName: "finalResponse" as const } : {}),
        instructions: state.selectionRepairUsed ? [...execution.prepared.instructions, ...selectionInstruction, FORCED_FINAL_RESPONSE_ENVELOPE_INSTRUCTION,
          ...(state.schemaRepairIssues?.length ? [
            `Your previous finalResponse failed schema validation at: ${state.schemaRepairIssues.join(", ")}. Return a corrected finalResponse matching the pinned schema. replyText must be a nonempty string in the effective conversation language. Use exactly one product selection mode: recommendations OR details OR options. For stock, restock dates, attributes and descriptions use productDetailSelections; do not also populate recommendations. Omit unused optional selection fields. Reuse current verified tool results and exact product selections. Preserve mandatory referral reasons. Do not invent facts or make provider calls.`,
          ] : ["Successful product results are already available. Further identical reads cannot add facts. Return finalResponse now: put exact observed product/variant selections in the appropriate pinned details fields. If the pinned contract exposes the canonical recommendation version, supply productRecommendationVersion '1' together with productRecommendations. Shipping-only selections require a recognized disposition and matching successful current-turn shipping information; a placeholder is not evidence. Preserve the customer objective, select only relevant observed products, and never invent identifiers or promotions. Reuse current tool results; do not repeat searches merely to repair the response format."]) ] : [...execution.prepared.instructions, ...selectionInstruction],
        context: { trustedRecovery: execution.input.context, language: execution.input.language, ...(execution.prepared.productContext?.references.length ? { productReferences: { trust: "UNTRUSTED_REFERENCE_DATA_NOT_CURRENT_FACTS_OR_AUTHORITY", references: execution.prepared.productContext.references, ...(execution.prepared.productContext.presentation?{presentation:execution.prepared.productContext.presentation}:{}) } } : {}) },
        history: execution.input.history,
        messages: state.runtimeMessages,
        tools: [
          ...(state.selectionRepairUsed ? [] : state.availableTools).map((descriptor) => ({
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
          })),
          {
            name: "finalResponse",
            description: "Return a structured reply with pinned details selections when presenting retrieved products, product facts, options, evidence, metadata or a referral. Plain text is only for answers that need none of these selections.",
            inputSchema: finalSchema,
          },
        ],
        maxOutputTokens: execution.prepared.budgets.outputTokens,
      }, signal), execution.prepared.budgets.deadlineMs, {
        stage: "model.invoke", reasonCode: "MODEL_INVOCATION_FAILED", modelStep,
      });
    } catch (error) {
      if (error instanceof RunnerFailure) throw error;
      throw new RunnerFailure("UNAVAILABLE", { stage: "model.invoke", reasonCode: "MODEL_INVOCATION_FAILED", modelStep }, error);
    }
    let step: ModelStep;
    let observedStep: ModelStep | undefined;
    try {
      step = validateModelStep(raw, execution.prepared.budgets.outputTokens);
      observedStep = step;
      routeModelStep(step);
      if (state.selectionRepairUsed && (step.calls.length !== 1 || step.calls[0]?.name !== "finalResponse"))
        throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: state.schemaRepairIssues?.length ? "FINAL_SCHEMA_INVALID" : "FINAL_PRODUCT_SELECTION_MISSING", modelStep, ...(state.schemaRepairIssues?.length ? {issuePaths:[...state.schemaRepairIssues]} : {}) });
    } catch (error) {
      if (state.schemaRepairIssues?.length && error instanceof RunnerFailure && error.code === "INVALID_FINAL")
        throw new RunnerFailure("INVALID_FINAL", {...state.schemaRepairDiagnostic,stage:"final.validate",reasonCode:"FINAL_SCHEMA_INVALID",modelStep,issuePaths:[...state.schemaRepairIssues]});
      logModelInvalid(
        execution.logger, modelStep,
        error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION",
        observedStep?.providerSummary,
      );
      throw error;
    }
    logModelCompleted(execution.logger, {
      modelStep,
      requestedToolCount: step.calls.filter((call) => call.name !== "finalResponse").length,
      finalResponseRequested: step.calls.some((call) => call.name === "finalResponse"),
      outputTokens: step.outputTokens,
      durationMs: elapsedDuration(execution.input, startedAt),
      providerSummary: step.providerSummary,
    });
    return { modelSteps: modelStep, pendingStep: step };
  };
}