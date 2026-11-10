import { RunnerFailure } from "../../failure.js";
import { executeToolCalls } from "../../tool-execution.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";

export function executeToolCallsNode(execution: CommerceTurnGraphExecution) {
  const productReadCache: NonNullable<Parameters<typeof executeToolCalls>[0]["productReadCache"]> = new Map();
  return async (state: CommerceTurnGraphStateValue) => {
    if (!state.pendingStep) throw new RunnerFailure("INVALID_FINAL", { stage: "graph.execute", reasonCode: "MODEL_RESULT_MISSING" });
    const result = await executeToolCalls({
      productReadCache,
      source: execution.input,
      prepared: execution.prepared,
      runtime: execution.runtime,
      modelStep: state.modelSteps,
      step: state.pendingStep,
      availableTools: state.availableTools,
      remoteCalls: state.remoteCalls,
      runtimeMessages: state.runtimeMessages,
      evidenceById: state.evidenceById,
      requiredReferral: state.requiredReferral,
      logger: execution.logger,
      onRemoteCall: (remoteCalls) => { execution.stats.remoteCalls = remoteCalls; },
    });
    return { ...result, pendingStep: null };
  };
}