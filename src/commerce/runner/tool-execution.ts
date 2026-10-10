import { jsonBytes } from "../canonical-json.js";
import { CommerceToolResultSchema, type CommerceEvidence } from "../schemas.js";
import type { CommerceFinalResponse } from "../response.js";
import { compileSubset } from "../subset.js";
import { RunnerFailure } from "./failure.js";
import { schemaIssueMetadata } from "./diagnostics.js";
import { collectVerifiedEvidence } from "./evidence.js";
import { elapsedDuration, safeLog, type CommerceTurnLogger } from "./observability.js";
import type { PreparedCommerceTurn } from "./preflight.js";
import type { CommerceTurnRuntime } from "./runtime.js";
import { resolveToolCall } from "./tool-policy.js";
import type { RunCommerceTurnInput, ModelStep } from "./types.js";

export type ToolExecutionResult = {
  remoteCalls: number;
  runtimeMessages: ReadonlyArray<{ tool: string; result: unknown }>;
  evidenceById: Readonly<Record<string, CommerceEvidence>>;
  requiredReferral: CommerceFinalResponse["referralReason"];
};

export async function executeToolCalls(input: {
  source: RunCommerceTurnInput;
  prepared: PreparedCommerceTurn;
  runtime: CommerceTurnRuntime;
  modelStep: number;
  step: ModelStep;
  availableTools: Parameters<typeof resolveToolCall>[2];
  remoteCalls: number;
  runtimeMessages: ReadonlyArray<{ tool: string; result: unknown }>;
  evidenceById: Readonly<Record<string, CommerceEvidence>>;
  requiredReferral: CommerceFinalResponse["referralReason"];
  logger: CommerceTurnLogger;
  onRemoteCall?: (remoteCalls: number) => void;
}): Promise<ToolExecutionResult> {
  let remoteCalls = input.remoteCalls;
  const runtimeMessages = [...input.runtimeMessages];
  const evidenceById = { ...input.evidenceById };
  let requiredReferral = input.requiredReferral;

  for (const call of input.step.calls) {
    input.runtime.checkCancellationAndDeadline();
    const policy = resolveToolCall(call.name, input.prepared, input.availableTools);
    if ("denial" in policy) {
      requiredReferral = policy.denial;
      safeLog(input.logger, "warn", "commerce.turn.tool.denied", {
        modelStep: input.modelStep,
        toolName: call.name,
        reasonCode: policy.denial,
      });
      runtimeMessages.push({
        tool: call.name,
        result: { contractVersion: "commerce.v1", status: "ERROR", code: "DENIED", retryable: false },
      });
      continue;
    }
    const { grant, tool } = policy;
    if (!(await input.runtime.bounded((signal) => tool.isAuthorized(grant, signal), 10000, {
      stage: "tool.authorize", reasonCode: "TOOL_AUTHORIZATION_FAILED", toolName: call.name, modelStep: input.modelStep,
    }))) {
      requiredReferral = "TOOL_REVOKED";
      safeLog(input.logger, "warn", "commerce.turn.tool.denied", {
        modelStep: input.modelStep,
        toolName: call.name,
        reasonCode: "TOOL_REVOKED",
      });
      runtimeMessages.push({
        tool: call.name,
        result: { contractVersion: "commerce.v1", status: "ERROR", code: "DENIED", retryable: false },
      });
      continue;
    }
    const args = compileSubset(tool.descriptor.inputSchema, "input").safeParse(call.arguments);
    if (!args.success) throw new RunnerFailure("INVALID_INPUT", {
      stage: "tool.validate", reasonCode: "TOOL_INPUT_INVALID", toolName: call.name,
      modelStep: input.modelStep, ...schemaIssueMetadata(args.error),
    }, args.error);

    let result: ReturnType<typeof CommerceToolResultSchema.parse> | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (remoteCalls >= input.prepared.budgets.remoteCalls)
        throw new RunnerFailure("BUDGET_EXHAUSTED", {
          stage: "tool.execute", reasonCode: "TOOL_CALL_BUDGET_EXHAUSTED", toolName: call.name, modelStep: input.modelStep,
        });
      const remoteCallNumber = remoteCalls + 1;
      const startedAt = input.source.dependencies.now();
      safeLog(input.logger, "debug", "commerce.turn.tool.started", {
        modelStep: input.modelStep,
        toolName: call.name,
        attempt,
        remoteCallNumber,
      });
      remoteCalls += 1;
      input.onRemoteCall?.(remoteCalls);
      const raw = await input.runtime.bounded((signal) => tool.execute(args.data, signal), 10000, {
        stage: "tool.execute", reasonCode: "TOOL_EXECUTION_FAILED", toolName: call.name,
        modelStep: input.modelStep, attempt, remoteCallNumber,
      });
      let rawSize: number;
      try { rawSize = jsonBytes(raw); }
      catch (error) {
        throw new RunnerFailure("INVALID_INPUT", { stage: "tool.result", reasonCode: "TOOL_RESULT_INVALID",
          toolName: call.name, modelStep: input.modelStep, attempt, remoteCallNumber }, error);
      }
      if (rawSize > 262144) throw new RunnerFailure("UNAVAILABLE", {
        stage: "tool.result", reasonCode: "TOOL_RESULT_TOO_LARGE", toolName: call.name,
        modelStep: input.modelStep, attempt, remoteCallNumber,
      });
      const parsedResult = CommerceToolResultSchema.safeParse(raw);
      if (!parsedResult.success) throw new RunnerFailure("INVALID_INPUT", {
        stage: "tool.result", reasonCode: "TOOL_RESULT_INVALID", toolName: call.name,
        modelStep: input.modelStep, attempt, remoteCallNumber, ...schemaIssueMetadata(parsedResult.error),
      }, parsedResult.error);
      result = parsedResult.data;
      const durationMs = elapsedDuration(input.source, startedAt);
      safeLog(input.logger, "debug", "commerce.turn.tool.completed", {
        modelStep: input.modelStep,
        toolName: call.name,
        attempt,
        status: result.status,
        ...(result.status === "ERROR" ? { errorCode: result.code, retryable: result.retryable } : {}),
        durationMs,
        remoteCallNumber,
      });
      if (
        attempt === 1 && result.status === "ERROR" && result.retryable &&
        (result.code === "UNAVAILABLE" || result.code === "THROTTLED")
      ) {
        safeLog(input.logger, "warn", "commerce.turn.tool.retry", {
          modelStep: input.modelStep,
          toolName: call.name,
          attempt,
          errorCode: result.code,
        });
        continue;
      }
      break;
    }
    if (!result) throw new RunnerFailure("UNAVAILABLE", {
      stage: "tool.result", reasonCode: "TOOL_RESULT_MISSING", toolName: call.name, modelStep: input.modelStep,
    });
    if (result.status === "ERROR") {
      if (result.code === "STALE_TURN") throw new RunnerFailure("STALE_TURN", {
        stage: "tool.result", reasonCode: "TOOL_STALE_TURN", toolName: call.name, modelStep: input.modelStep,
      });
      requiredReferral = result.code === "DENIED" ? "TOOL_REVOKED" : "TOOL_UNAVAILABLE";
    }
    for (const evidence of collectVerifiedEvidence({
      source: input.source,
      prepared: input.prepared,
      runtime: input.runtime,
      tool,
      toolName: call.name,
      result,
      modelStep: input.modelStep,
      logger: input.logger,
    })) evidenceById[evidence.evidenceId] = evidence;
    runtimeMessages.push({ tool: call.name, result });
  }

  return { remoteCalls, runtimeMessages, evidenceById, requiredReferral };
}