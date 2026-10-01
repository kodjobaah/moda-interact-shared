import type { RunCommerceTurnInput, RunnerErrorCode, RunCommerceTurnResult } from "./types.js";

export class RunnerFailure extends Error {
  constructor(readonly code: RunnerErrorCode) {
    super(code);
    this.name = "RunnerFailure";
  }
}

export function mapRunnerFailure(error: unknown, signal?: AbortSignal): RunCommerceTurnResult {
  const code = error instanceof RunnerFailure
    ? error.code
    : signal?.aborted
      ? "CANCELLED"
      : "INVALID_INPUT";
  return {
    ok: false,
    error: { code, retryable: code === "UNAVAILABLE" || code === "DEADLINE" },
  };
}

export function failureCode(error: unknown): RunnerErrorCode {
  return error instanceof RunnerFailure ? error.code : "INVALID_INPUT";
}

export function inputSignal(input: RunCommerceTurnInput): AbortSignal {
  return input.signal;
}