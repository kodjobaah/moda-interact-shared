import { RunnerFailure, mapRunnerFailure } from "./failure.js";
import { createCommerceTurnGraph, COMMERCE_TURN_GRAPH_RECURSION_LIMIT } from "./graph/graph.js";
import { initialCommerceTurnGraphState } from "./graph/state.js";
import {
  createRootTurnLogger,
  createTurnLogger,
  elapsedDuration,
  safeLog,
  type CommerceTurnLogger,
} from "./observability.js";
import { prepareCommerceTurn } from "./preflight.js";
import { createCommerceTurnRuntime, type CommerceTurnRuntime } from "./runtime.js";
import type { RunnerDiagnosticStage } from "./diagnostics.js";
import type { RunCommerceTurnInput, RunCommerceTurnResult, RunnerErrorCode } from "./types.js";

export {
  PLATFORM_INSTRUCTIONS,
  RUNTIME_DATA_AUTHORITY_INSTRUCTION,
  composeTrustedInstructions,
} from "./instructions.js";
export { CommerceModelInvocationFailure } from "./failure.js";
export type { RunnerDiagnostic, RunnerDiagnosticReason, RunnerDiagnosticStage } from "./diagnostics.js";
export { runnerVersion } from "./version.js";
export type {
  CommerceModelInvoker,
  ModelCall,
  ModelRequest,
  ModelStep,
  RunCommerceTurnInput,
  RunCommerceTurnResult,
  RunnerErrorCode,
  RunnerTool,
} from "./types.js";

export async function runCommerceTurn(input: RunCommerceTurnInput): Promise<RunCommerceTurnResult> {
  let stage: RunnerDiagnosticStage = "preflight.validate";
  let runtime: CommerceTurnRuntime | undefined;
  let logger: CommerceTurnLogger = createRootTurnLogger(input);
  let modelSteps = 0;
  let remoteCalls = 0;
  const stats = { modelSteps: 0, remoteCalls: 0 };
  let startedAt: number | undefined;
  try {
    const prepared = prepareCommerceTurn(input);
    runtime = createCommerceTurnRuntime({
      callerSignal: input.signal,
      now: input.dependencies.now,
      deadlineMs: prepared.budgets.deadlineMs,
    });
    logger = createTurnLogger(input, prepared);
    stage = "graph.execute";
    startedAt = input.dependencies.now();
    safeLog(logger, "info", "commerce.turn.started", {
      modelStepBudget: prepared.budgets.modelSteps,
      remoteCallBudget: prepared.budgets.remoteCalls,
      deadlineMs: prepared.budgets.deadlineMs,
      outputTokenBudget: prepared.budgets.outputTokens,
    });

    const graph = createCommerceTurnGraph({ input, prepared, runtime, logger, stats });
    const state = await graph.invoke(initialCommerceTurnGraphState(), {
      recursionLimit: COMMERCE_TURN_GRAPH_RECURSION_LIMIT,
    });
    modelSteps = state.modelSteps;
    remoteCalls = state.remoteCalls;
    if (!state.finalResult) throw new RunnerFailure("INVALID_FINAL", { stage: "graph.execute", reasonCode: "MODEL_RESULT_MISSING" });
    safeLog(logger, "info", "commerce.turn.completed", {
      answerKind: state.finalResult.answerKind,
      modelSteps,
      remoteCalls,
      evidenceCount: state.finalResult.evidenceIds.length,
      durationMs: elapsedDuration(input, startedAt),
    });
    return {
      ok: true,
      result: state.finalResult,
      usage: { modelSteps, remoteCalls },
    };
  } catch (error) {
    modelSteps = stats.modelSteps;
    remoteCalls = stats.remoteCalls;
    const result = mapRunnerFailure(error, input.signal, stage);
    if (!result.ok) {
      safeLog(logger, failureLevel(result.error.code), "commerce.turn.failed", {
        errorCode: result.error.code,
        retryable: result.error.retryable,
        ...result.error.diagnostic,
        modelSteps,
        remoteCalls,
        durationMs: safeFailureDuration(input, startedAt),
      });
    }
    return result;
  } finally {
    runtime?.dispose();
  }
}

function failureLevel(code: RunnerErrorCode): "warn" | "error" {
  return ["CANCELLED", "DENIED", "STALE_TURN", "BUDGET_EXHAUSTED"].includes(code)
    ? "warn"
    : "error";
}
function safeFailureDuration(input: RunCommerceTurnInput, startedAt?: number): number {
  if (startedAt === undefined) return 0;
  try { return elapsedDuration(input, startedAt); }
  catch { return 0; }
}
