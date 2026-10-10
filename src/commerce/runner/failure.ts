import type { RunCommerceTurnInput, RunnerErrorCode, RunCommerceTurnResult } from "./types.js";
import { safeRunnerCauseMetadata, safeRunnerDiagnostic, type RunnerDiagnostic, type RunnerDiagnosticStage } from "./diagnostics.js";

export class RunnerFailure extends Error {
  readonly diagnostic: RunnerDiagnostic;

  constructor(readonly code: RunnerErrorCode, diagnostic: RunnerDiagnostic, cause?: unknown) {
    super(code, { cause });
    this.name = "RunnerFailure";
    this.diagnostic = safeRunnerDiagnostic({ ...safeRunnerCauseMetadata(cause), ...diagnostic });
  }
}

/** Typed, provider-independent cause that model invokers may throw. */
export class CommerceModelInvocationFailure extends Error {
  readonly diagnostic: RunnerDiagnostic;

  constructor(diagnostic: RunnerDiagnostic, cause?: unknown) {
    super("Commerce model unavailable", { cause });
    this.name = "CommerceModelInvocationFailure";
    this.diagnostic = safeRunnerDiagnostic({ ...safeRunnerCauseMetadata(cause), ...diagnostic });
  }
}

function findRunnerFailure(error: unknown): RunnerFailure | undefined {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof RunnerFailure) return current;
    current = current.cause;
  }
  return undefined;
}

export function mapRunnerFailure(
  error: unknown, signal?: AbortSignal, fallbackStage: RunnerDiagnosticStage = "graph.execute",
): RunCommerceTurnResult {
  const failure = findRunnerFailure(error);
  const code = failure?.code ?? (signal?.aborted ? "CANCELLED" : "INVALID_INPUT");
  const diagnostic = failure?.diagnostic ?? safeRunnerDiagnostic(signal?.aborted
    ? { stage: "runtime.cancellation", reasonCode: "CANCELLED_BY_CALLER" }
    : { stage: fallbackStage, reasonCode: "UNEXPECTED_EXCEPTION", ...safeRunnerCauseMetadata(error) });
  return {
    ok: false,
    error: { code, retryable: code === "UNAVAILABLE" || code === "DEADLINE", diagnostic },
  };
}

export function failureCode(error: unknown): RunnerErrorCode {
  return findRunnerFailure(error)?.code ?? "INVALID_INPUT";
}

export function inputSignal(input: RunCommerceTurnInput): AbortSignal {
  return input.signal;
}
