import { RunnerFailure } from "../../failure.js";
import { validateFinalResponse } from "../../final-response.js";
import { logModelInvalid } from "../../observability.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";

export function validateFinalResponseNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue) => {
    if (!state.pendingStep)
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "MODEL_RESULT_MISSING" });
    try {
      // A plain-text answer has no authority to invent detection metadata, evidence or
      // response-contract details. The same pinned final schema still validates it.
      // If a denied/failed tool requires referral, do not let text evade that rule.
      const raw = state.pendingStep.calls.length === 0
        ? {
            answerKind: "ANSWER",
            replyText: state.pendingStep.text?.trim() ?? "",
            referralReason: null,
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
      return { finalResult: final };
    } catch (error) {
      logModelInvalid(execution.logger, state.modelSteps, error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION");
      throw error;
    }
  };
}