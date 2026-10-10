import { RunnerFailure } from "../../failure.js";
import { resolveAvailableTools } from "../../tool-policy.js";
import type { CommerceTurnGraphExecution } from "../graph.js";
import type { CommerceTurnGraphStateValue } from "../state.js";

export function resolveAvailableToolsNode(execution: CommerceTurnGraphExecution) {
  return async (state: CommerceTurnGraphStateValue) => {
    execution.runtime.checkCancellationAndDeadline();
    if (state.modelSteps >= execution.prepared.budgets.modelSteps)
      throw new RunnerFailure("BUDGET_EXHAUSTED", { stage: "tools.resolve", reasonCode: "MODEL_STEP_BUDGET_EXHAUSTED" });
    const availableTools = await resolveAvailableTools(execution.prepared, execution.runtime);
    return { availableTools };
  };
}