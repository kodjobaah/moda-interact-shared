import { jsonBytes } from "../canonical-json.js";
import type { RunnerDiagnosticReason } from "./diagnostics.js";
import { RunnerFailure } from "./failure.js";
import type { ModelStep } from "./types.js";

function invalidStep(reasonCode: RunnerDiagnosticReason, callIndex?: number, cause?: unknown): never {
  throw new RunnerFailure("INVALID_FINAL", {
    stage: "model.validate", reasonCode,
    ...(callIndex === undefined ? {} : { callIndex }),
  }, cause);
}

/** Report the first violated invariant rather than grouping unrelated model-output failures. */
export function validateModelStep(step: unknown, outputTokenBudget: number): ModelStep {
  try {
    if (step === null || typeof step !== "object" || Array.isArray(step))
      invalidStep("MODEL_STEP_NOT_OBJECT");
    const value = step as Record<string, unknown>;
    if (!Object.hasOwn(value, "calls")) invalidStep("MODEL_STEP_CALLS_MISSING");
    if (!Array.isArray(value.calls)) invalidStep("MODEL_STEP_CALLS_NOT_ARRAY");
    if (!Object.hasOwn(value, "outputTokens")) invalidStep("MODEL_OUTPUT_TOKENS_MISSING");
    if (!Number.isSafeInteger(value.outputTokens)) invalidStep("MODEL_OUTPUT_TOKENS_NOT_SAFE_INTEGER");
    const outputTokens = value.outputTokens as number;
    if (outputTokens < 0) invalidStep("MODEL_OUTPUT_TOKENS_NEGATIVE");
    if (outputTokens > outputTokenBudget) invalidStep("MODEL_OUTPUT_TOKENS_OVER_BUDGET");

    const calls = value.calls as unknown[];
    if (calls.length > 32) invalidStep("MODEL_TOOL_CALL_LIMIT_EXCEEDED");
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      if (call === null) invalidStep("MODEL_TOOL_CALL_NULL", index);
      if (typeof call !== "object" || Array.isArray(call)) invalidStep("MODEL_TOOL_CALL_NOT_OBJECT", index);
      const fields = call as Record<string, unknown>;
      if (!Object.hasOwn(fields, "name")) invalidStep("MODEL_TOOL_CALL_NAME_MISSING", index);
      if (typeof fields.name !== "string") invalidStep("MODEL_TOOL_CALL_NAME_NOT_STRING", index);
      if (!fields.name.length) invalidStep("MODEL_TOOL_CALL_NAME_EMPTY", index);
      if (fields.name.length > 128) invalidStep("MODEL_TOOL_CALL_NAME_TOO_LONG", index);
      if (!Object.hasOwn(fields, "arguments")) invalidStep("MODEL_TOOL_CALL_ARGUMENTS_MISSING", index);
      if (fields.arguments === null) invalidStep("MODEL_TOOL_CALL_ARGUMENTS_NULL", index);
      if (typeof fields.arguments !== "object" || Array.isArray(fields.arguments))
        invalidStep("MODEL_TOOL_CALL_ARGUMENTS_NOT_OBJECT", index);
    }

    let size: number;
    try {
      size = jsonBytes(step);
    } catch (error) {
      invalidStep("MODEL_STEP_NOT_SERIALIZABLE", undefined, error);
    }
    if (size > 262144) invalidStep("MODEL_STEP_TOO_LARGE");
    return step as ModelStep;
  } catch (error) {
    if (error instanceof RunnerFailure) throw error;
    invalidStep("MODEL_STEP_VALIDATION_FAILED", undefined, error);
  }
}

export function routeModelStep(step: ModelStep): "toolCalls" | "finalResponse" {
  const finalCalls = step.calls.filter((call) => call.name === "finalResponse");
  if (finalCalls.length > 0) {
    if (finalCalls.length !== 1 || step.calls.length !== 1)
      throw new RunnerFailure("INVALID_FINAL", { stage: "model.route", reasonCode: "MODEL_CALL_ROUTE_INVALID" });
    return "finalResponse";
  }
  if (step.calls.length === 0)
    throw new RunnerFailure("INVALID_FINAL", { stage: "model.route", reasonCode: "MODEL_CALL_ROUTE_INVALID" });
  return "toolCalls";
}
