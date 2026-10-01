import { END, START, StateGraph } from "@langchain/langgraph";
import { RunnerFailure } from "../failure.js";
import { routeModelStep } from "../model-step.js";
import type { CommerceTurnLogger } from "../observability.js";
import type { PreparedCommerceTurn } from "../preflight.js";
import type { CommerceTurnRuntime } from "../runtime.js";
import type { RunCommerceTurnInput } from "../types.js";
import {
  CommerceTurnGraphState,
  type CommerceTurnGraphStateValue,
} from "./state.js";
import { executeToolCallsNode } from "./nodes/execute-tool-calls.js";
import { invokeModelNode } from "./nodes/invoke-model.js";
import { resolveAvailableToolsNode } from "./nodes/resolve-available-tools.js";
import { validateFinalResponseNode } from "./nodes/validate-final-response.js";

export const COMMERCE_TURN_GRAPH_RECURSION_LIMIT = 64;

export type CommerceTurnGraphExecution = {
  input: RunCommerceTurnInput;
  prepared: PreparedCommerceTurn;
  runtime: CommerceTurnRuntime;
  logger: CommerceTurnLogger;
  stats: { modelSteps: number; remoteCalls: number };
};

export function createCommerceTurnGraph(execution: CommerceTurnGraphExecution) {
  return new StateGraph(CommerceTurnGraphState)
    .addNode("resolveAvailableTools", resolveAvailableToolsNode(execution))
    .addNode("invokeModel", invokeModelNode(execution))
    .addNode("executeToolCalls", executeToolCallsNode(execution))
    .addNode("validateFinalResponse", validateFinalResponseNode(execution))
    .addEdge(START, "resolveAvailableTools")
    .addEdge("resolveAvailableTools", "invokeModel")
    .addConditionalEdges("invokeModel", (state: CommerceTurnGraphStateValue) => {
      if (!state.pendingStep) throw new RunnerFailure("INVALID_FINAL");
      return routeModelStep(state.pendingStep);
    }, {
      toolCalls: "executeToolCalls",
      finalResponse: "validateFinalResponse",
    })
    .addEdge("executeToolCalls", "resolveAvailableTools")
    .addEdge("validateFinalResponse", END)
    .compile();
}