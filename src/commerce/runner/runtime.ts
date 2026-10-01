import { RunnerFailure } from "./failure.js";

export type CommerceTurnRuntime = {
  signal: AbortSignal;
  checkCancellationAndDeadline(): void;
  bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T>;
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
  const deadlineTimer = setTimeout(() => controller.abort(), input.deadlineMs);

  const checkCancellationAndDeadline = () => {
    if (input.callerSignal.aborted) throw new RunnerFailure("CANCELLED");
    if (controller.signal.aborted || input.now() - startedAt >= input.deadlineMs)
      throw new RunnerFailure("DEADLINE");
  };

  return {
    signal: controller.signal,
    checkCancellationAndDeadline,
    async bounded<T>(
      operation: (signal: AbortSignal) => Promise<T>,
      timeoutMs: number,
    ) {
      checkCancellationAndDeadline();
      const local = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => {
          local.abort();
          reject(new RunnerFailure(input.callerSignal.aborted ? "CANCELLED" : "DEADLINE"));
        };
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        timeout = setTimeout(() => {
          local.abort();
          reject(new RunnerFailure("DEADLINE"));
        }, Math.max(0, Math.min(timeoutMs, input.deadlineMs - (input.now() - startedAt))));
      });
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => operation(local.signal)).catch((error) => {
            throw error instanceof RunnerFailure ? error : new RunnerFailure("UNAVAILABLE");
          }),
          aborted,
        ]);
        checkCancellationAndDeadline();
        return value;
      } finally {
        clearTimeout(timeout);
        if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
        local.abort();
      }
    },
    dispose() {
      clearTimeout(deadlineTimer);
      input.callerSignal.removeEventListener("abort", abortFromCaller);
      controller.abort();
    },
  };
}