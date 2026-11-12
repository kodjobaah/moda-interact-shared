import { hasCommerceAcceptedProductSelection } from "../../../recommendation-selection.js";
import { hasObservedProducts, productSelectionFields } from "../../product-selection.js";
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
    let validationPhase: "schema" | "selection" | "observations" = "schema";
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
      validationPhase = "selection";
      const supportsSelections = productSelectionFields(execution.prepared.response).length > 0;
      const selected = hasCommerceAcceptedProductSelection(final.details, execution.prepared.response, state.runtimeMessages, execution.input.platform);
      validationPhase = "observations";
      const observedProducts = hasObservedProducts(state.runtimeMessages);
      validationPhase = "selection";
      // One correction uses the existing model-step/deadline budget. Never guess
      // selections or replay provider calls on the model's behalf.
      if (!state.requiredReferral && final.answerKind === 'ANSWER' && supportsSelections && observedProducts && !selected) {
        if (state.selectionRepairUsed) throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_PRODUCT_SELECTION_MISSING", modelStep: state.modelSteps });
        logModelInvalid(execution.logger, state.modelSteps, 'MISSING_PRODUCT_SELECTION_REPAIR');
        return { selectionRepairUsed: true, pendingStep: null, finalResult: null };
      }
      return { finalResult: final };
    } catch (error) {
      logModelInvalid(execution.logger, state.modelSteps, error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION");
      if (error instanceof RunnerFailure) {
        if (error.diagnostic.reasonCode === "FINAL_SCHEMA_INVALID" && !state.selectionRepairUsed) {
          return { selectionRepairUsed: true, schemaRepairDiagnostic:error.diagnostic, schemaRepairIssues: error.diagnostic.issuePaths?.length ? error.diagnostic.issuePaths : ["finalResponse"], pendingStep: null, finalResult: null };
        }
        throw error;
      }
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "UNEXPECTED_EXCEPTION", modelStep: state.modelSteps, validationPhase }, error);
    }
  };
}