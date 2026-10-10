import { finalResponseToolSchema } from "../../../response.js";
import { RunnerFailure } from "../../failure.js";
import { elapsedDuration, logModelCompleted, logModelInvalid, logModelStarted } from "../../observability.js";
import { validateModelStep, routeModelStep } from "../../model-step.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";
import type { ModelStep } from "../../types.js";

export function invokeModelNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue) => {
    execution.runtime.checkCancellationAndDeadline();
    const modelStep = state.modelSteps + 1;
    execution.stats.modelSteps = modelStep;
    const startedAt = execution.input.dependencies.now();
    logModelStarted(execution.logger, { modelStep, availableToolCount: state.availableTools.length });
    let raw: unknown;
    try {
      raw = await execution.runtime.bounded((signal) => execution.input.dependencies.model.invoke({
        instructions: execution.prepared.instructions,
        context: { trustedRecovery: execution.input.context, language: execution.input.language },
        history: execution.input.history,
        messages: state.runtimeMessages,
        tools: [
          ...state.availableTools.map((descriptor) => ({
            name: descriptor.name,
            description: descriptor.description,
            inputSchema: descriptor.inputSchema,
          })),
          {
            name: "finalResponse",
            description: "Return the only final structured reply.",
            inputSchema: finalResponseToolSchema(execution.prepared.response),
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
    try {
      step = validateModelStep(raw, execution.prepared.budgets.outputTokens);
      routeModelStep(step);
    } catch (error) {
      logModelInvalid(execution.logger, modelStep, error instanceof RunnerFailure ? error.diagnostic.reasonCode : "UNEXPECTED_EXCEPTION");
      throw error;
    }
    logModelCompleted(execution.logger, {
      modelStep,
      requestedToolCount: step.calls.filter((call) => call.name !== "finalResponse").length,
      finalResponseRequested: step.calls.some((call) => call.name === "finalResponse"),
      outputTokens: step.outputTokens,
      durationMs: elapsedDuration(execution.input, startedAt),
    });
    return { modelSteps: modelStep, pendingStep: step };
  };
}