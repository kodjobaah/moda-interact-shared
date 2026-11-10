import { RunnerFailure } from "../../failure.js";
import { validateFinalResponse } from "../../final-response.js";
import { logModelInvalid } from "../../observability.js";
import { safeReferralText } from "../../safe-referral-text.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";

export function validateFinalResponseNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue) => {
    if (!state.pendingStep)
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "MODEL_RESULT_MISSING" });
    try {
      // Natural text may finish a turn, but cannot override mandatory referral
      // after a failed/denied tool. Use trusted, localized host copy instead of
      // repeating potentially unsupported claims from the model.
      // The same pinned final schema validates both resulting envelopes.
      const raw = state.pendingStep.calls.length === 0
        ? {
            answerKind: state.requiredReferral ? "REFER_TO_STORE" : "ANSWER",
            replyText: state.requiredReferral
              ? safeReferralText(execution.input.language.tag)
              : state.pendingStep.text?.trim() ?? "",
            referralReason: state.requiredReferral,
            detectedLanguageTag: null,
            detectedLanguageConfidence: null,
            evidenceIds: [],
            details: {},
          }
        : state.pendingStep.calls.length === 1
          ? state.pendingStep.calls[0].arguments
          : undefined;
      const final = validateFinalResponse({
        raw,
        prepared: execution.prepared,
        evidenceById: state.evidenceById,
        requiredReferral: state.requiredReferral,
        remoteCalls: state.remoteCalls,
        now: execution.input.dependencies.now,
        languageSource: execution.input.language.source,
        checkCancellationAndDeadline: execution.runtime.checkCancellationAndDeadline,
      });
      const fields = execution.prepared.response.detailsSchema.properties ?? {};
      const supportsSelections = ['productRecommendations', 'productDetailSelections', 'productOptionSelections'].some(key => Object.hasOwn(fields, key));
      const selected = ['productRecommendations', 'productDetailSelections', 'productOptionSelections'].some(key => Array.isArray(final.details[key]) && final.details[key].length > 0);
      const observedProducts = state.runtimeMessages.some(message => {
        if (message.tool !== 'commerce_search_products' && message.tool !== 'commerce_get_product') return false;
        const result = message.result as { status?: string; data?: { products?: unknown[]; product?: unknown } };
        return result?.status === 'OK' && (Boolean(result.data?.product) || Boolean(result.data?.products?.length));
      });
      // One correction uses the existing model-step/deadline budget. Never guess
      // selections or replay provider calls on the model's behalf.
      if (!state.requiredReferral && final.answerKind === 'ANSWER' && supportsSelections && observedProducts && !selected && final.details.responseDisposition !== 'SHIPPING_INFORMATION_UNVERIFIED' && !final.details.shippingInformationSelection) {
        if (state.selectionRepairUsed) throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_PRODUCT_SELECTION_MISSING", modelStep: state.modelSteps });
        logModelInvalid(execution.logger, state.modelSteps, 'MISSING_PRODUCT_SELECTION_REPAIR');
        return { selectionRepairUsed: true, pendingStep: null, finalResult: null };
      }
      return { finalResult: final };
    } catch (error) {
      logModelInvalid(execution.logger, state.modelSteps, error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION");
      throw error;
    }
  };
}