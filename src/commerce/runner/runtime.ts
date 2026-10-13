import { CommerceModelInvocationFailure, RunnerFailure } from "./failure.js";
import type { RunnerDiagnostic } from "./diagnostics.js";

type BoundedOperationContext = Pick<RunnerDiagnostic, "stage" | "reasonCode" | "modelStep" | "toolName" | "attempt" | "remoteCallNumber">;

// Node/browser timers overflow above this delay. Schedule in segments rather
// than silently shortening a caller-provided deadline to a few milliseconds.
const MAX_TIMEOUT_MS = 2_147_483_647;
function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const schedule = (remainingMs: number) => {
    const interval = Math.min(remainingMs, MAX_TIMEOUT_MS);
    timer = setTimeout(() => {
      if (cancelled) return;
      const next = remainingMs - interval;
      if (next > 0) schedule(next);
      else callback();
    }, interval);
  };
  schedule(delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

export type CommerceTurnRuntime = {
  signal: AbortSignal;
  checkCancellationAndDeadline(): void;
  bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, context?: BoundedOperationContext): Promise<T>;
  dispose(): void;
};

export function createCommerceTurnRuntime(input: {
  callerSignal: AbortSignal;
  now: () => number;
  deadlineMs: number;
}): CommerceTurnRuntime {
  const controller = new AbortController();
  const startedAt = input.now();
  const abortFromCaller = () => controller.abort();
  input.callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  if (input.callerSignal.aborted) controller.abort();
  const cancelDeadlineTimer = scheduleTimeout(() => controller.abort(), input.deadlineMs);

  const abortFailure = () => input.callerSignal.aborted
    ? new RunnerFailure("CANCELLED", { stage: "runtime.cancellation", reasonCode: "CANCELLED_BY_CALLER" })
    : new RunnerFailure("DEADLINE", { stage: "runtime.deadline", reasonCode: "TURN_DEADLINE_EXCEEDED" });
  const checkCancellationAndDeadline = () => {
    if (input.callerSignal.aborted || controller.signal.aborted || input.now() - startedAt >= input.deadlineMs)
      throw abortFailure();
  };

  return {
    signal: controller.signal,
    checkCancellationAndDeadline,
    async bounded<T>(
      operation: (signal: AbortSignal) => Promise<T>,
      timeoutMs: number,
      context?: BoundedOperationContext,
    ) {
      checkCancellationAndDeadline();
      const local = new AbortController();
      let cancelOperationTimer: (() => void) | undefined;
      let rejectAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => {
          local.abort();
          reject(abortFailure());
        };
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        const remainingMs = input.deadlineMs - (input.now() - startedAt);
        const operationTimeout = timeoutMs < remainingMs;
        cancelOperationTimer = scheduleTimeout(() => {
          local.abort();
          reject(input.callerSignal.aborted || controller.signal.aborted || !operationTimeout
            ? abortFailure()
            : new RunnerFailure("DEADLINE", {
              stage: "runtime.operation", reasonCode: "OPERATION_TIMEOUT",
              ...operationMetadata(context),
            }));
        }, Math.max(0, Math.min(timeoutMs, remainingMs)));
      });
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => operation(local.signal)).catch((error) => {
            if (error instanceof RunnerFailure) throw error;
            if (error instanceof CommerceModelInvocationFailure)
              throw new RunnerFailure("UNAVAILABLE", { ...error.diagnostic, ...operationMetadata(context) }, error);
            throw new RunnerFailure("UNAVAILABLE", {
              stage: context?.stage ?? "runtime.operation",
              reasonCode: context?.reasonCode ?? "UPSTREAM_OPERATION_FAILED",
              ...operationMetadata(context),
            }, error);
          }),
          aborted,
        ]);
        checkCancellationAndDeadline();
        return value;
      } finally {
        cancelOperationTimer?.();
        if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
        local.abort();
      }
    },
    dispose() {
      cancelDeadlineTimer();
      input.callerSignal.removeEventListener("abort", abortFromCaller);
      controller.abort();
    },
  };
}

function operationMetadata(context?: BoundedOperationContext) {
  return {
    ...(context?.modelStep === undefined ? {} : { modelStep: context.modelStep }),
    ...(context?.toolName === undefined ? {} : { toolName: context.toolName }),
    ...(context?.attempt === undefined ? {} : { attempt: context.attempt }),
    ...(context?.remoteCallNumber === undefined ? {} : { remoteCallNumber: context.remoteCallNumber }),
  };
}
