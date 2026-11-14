import {projectTerminalDecision} from '../../terminal-decision.js';
import {appendCurrentTurnTool,appendCurrentTurnRunnerFeedback,type CurrentTurnToolPayload} from '../../tool-transcript.js';
import { hasCommerceAcceptedProductSelection } from "../../../recommendation-selection.js";
import { hasObservedProducts, productSelectionFields } from "../../product-selection.js";
import { RunnerFailure } from "../../failure.js";
import { validateFinalResponse } from "../../final-response.js";
import { logModelInvalid } from "../../observability.js";
import { safeReferralText } from "../../safe-referral-text.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";

export function validateFinalResponseNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue):Promise<Partial<CommerceTurnGraphStateValue>> => {
    if (!state.pendingStep)
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "MODEL_RESULT_MISSING" });
    const withOutcome=(payload:CurrentTurnToolPayload)=>{
      if(execution.input.toolProtocol!=='native')return {};
      if(state.pendingStep!.calls.length===1)return {toolTranscript:appendCurrentTurnTool(state.toolTranscript,state.pendingStep!.calls[0]!,payload)};
      if(payload.kind==='runner-feedback'&&(payload.reasonCode==='FINAL_SCHEMA_INVALID'||payload.reasonCode==='FINAL_PRODUCT_SELECTION_MISSING'))return {toolTranscript:appendCurrentTurnRunnerFeedback(state.toolTranscript,{reasonCode:payload.reasonCode,...(payload.issuePaths===undefined?{}:{issuePaths:payload.issuePaths})})};
      return {};
    };
    let validationPhase: "schema" | "selection" | "observations" = "schema";
    try {
      // Natural text may finish a turn, but cannot override mandatory referral
      // after a failed/denied tool. Use trusted, localized host copy instead of
      // repeating potentially unsupported claims from the model.
      // The same pinned final schema validates both resulting envelopes.
      const projected=state.terminalProjection;
      const raw = projected
        ? projectTerminalDecision({port:execution.prepared.finalizeTerminal!,step:state.pendingStep,turn:execution.prepared.turn,modelStep:state.modelSteps,responseContractHash:execution.prepared.manifest.responseContractHash,observations:state.runtimeMessages,requiredReferral:state.requiredReferral,allowedToolNames:state.terminalToolNames,digest:execution.input.dependencies.digest,runtime:execution.runtime})
        : state.pendingStep.calls.length === 0
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
        if (state.selectionRepairUsed||state.terminalProjection) throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_PRODUCT_SELECTION_MISSING", modelStep: state.modelSteps });
        logModelInvalid(execution.logger, state.modelSteps, 'MISSING_PRODUCT_SELECTION_REPAIR');
        return { selectionRepairUsed: true, pendingStep: null, finalResult: null, ...withOutcome({kind:"runner-feedback",reasonCode:"FINAL_PRODUCT_SELECTION_MISSING"}) };
      }
      return { finalResult: final, ...withOutcome({kind:"runner-feedback",reasonCode:"FINAL_RESPONSE_ACCEPTED"}) };
    } catch (error) {
      logModelInvalid(execution.logger, state.modelSteps, error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION");
      if (error instanceof RunnerFailure) {
        if (error.diagnostic.reasonCode === "FINAL_SCHEMA_INVALID" && !state.selectionRepairUsed && !state.terminalProjection) {
          return { ...withOutcome({kind:"runner-feedback",reasonCode:"FINAL_SCHEMA_INVALID",...(error.diagnostic.issuePaths?.length?{issuePaths:error.diagnostic.issuePaths}:{})}), selectionRepairUsed: true, schemaRepairDiagnostic:error.diagnostic, schemaRepairIssues: error.diagnostic.issuePaths?.length ? error.diagnostic.issuePaths : ["finalResponse"], pendingStep: null, finalResult: null };
        }
        throw error;
      }
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "UNEXPECTED_EXCEPTION", modelStep: state.modelSteps, validationPhase }, error);
    }
  };
}