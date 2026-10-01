import { jsonBytes } from "../canonical-json.js";
import { RunnerFailure } from "./failure.js";
import type { ModelStep } from "./types.js";

export function validateModelStep(step: unknown, outputTokenBudget: number): ModelStep {
  try {
    if (
      !step || typeof step !== "object" || Array.isArray(step) ||
      !Array.isArray((step as ModelStep).calls) ||
      !Number.isSafeInteger((step as ModelStep).outputTokens) ||
      (step as ModelStep).outputTokens < 0 ||
      (step as ModelStep).outputTokens > outputTokenBudget ||
      (step as ModelStep).calls.length > 32 ||
      (step as ModelStep).calls.some((call) =>
        !call || typeof call !== "object" || Array.isArray(call) ||
        typeof call.name !== "string" || !call.name.length || call.name.length > 128 ||
        !Object.hasOwn(call, "arguments") || !call.arguments ||
        typeof call.arguments !== "object" || Array.isArray(call.arguments)
      ) ||
      jsonBytes(step) > 262144
    ) throw new RunnerFailure("INVALID_FINAL");
    return step as ModelStep;
  } catch {
    throw new RunnerFailure("INVALID_FINAL");
  }
}

export function routeModelStep(step: ModelStep): "toolCalls" | "finalResponse" {
  const finalCalls = step.calls.filter((call) => call.name === "finalResponse");
  if (finalCalls.length > 0) {
    if (finalCalls.length !== 1 || step.calls.length !== 1)
      throw new RunnerFailure("INVALID_FINAL");
    return "finalResponse";
  }
  if (step.calls.length === 0) throw new RunnerFailure("INVALID_FINAL");
  return "toolCalls";
}