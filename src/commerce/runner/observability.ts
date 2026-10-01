import type { LogFields, StructuredLogger } from "../../logging/index.js";
import type { PreparedCommerceTurn } from "./preflight.js";
import type { RunCommerceTurnInput } from "./types.js";

export type CommerceTurnLogger = StructuredLogger | undefined;

export function safeLog(
  logger: StructuredLogger | undefined,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields: LogFields,
): void {
  try {
    logger?.[level](event, fields);
  } catch {
    // Logging is an isolated diagnostic side effect.
  }
}

export function createTurnLogger(
  input: RunCommerceTurnInput,
  prepared: PreparedCommerceTurn,
): CommerceTurnLogger {
  try {
    const fields: Record<string, unknown> = {
      component: "commerce-turn-runner",
      runnerVersion: "1.0.0",
      shopId: prepared.turn.shopId,
      conversationId: prepared.turn.conversationId,
      inboundVersion: prepared.turn.inboundVersion,
      grantId: prepared.grant.id,
      releaseId: prepared.grant.releaseId,
    };
    if (prepared.turn.checkoutRecoveryId !== undefined)
      fields.checkoutRecoveryId = prepared.turn.checkoutRecoveryId;
    return input.dependencies.logger?.child(fields);
  } catch {
    return undefined;
  }
}

export function elapsedDuration(input: RunCommerceTurnInput, startedAt: number): number {
  const elapsed = input.dependencies.now() - startedAt;
  if (!Number.isFinite(elapsed)) return 0;
  return Math.max(0, Math.min(90000, elapsed));
}

export function logModelStarted(
  logger: CommerceTurnLogger,
  fields: { modelStep: number; availableToolCount: number },
) {
  safeLog(logger, "debug", "commerce.turn.model.started", fields);
}

export function logModelCompleted(
  logger: CommerceTurnLogger,
  fields: {
    modelStep: number;
    requestedToolCount: number;
    finalResponseRequested: boolean;
    outputTokens: number;
    durationMs: number;
  },
) {
  safeLog(logger, "debug", "commerce.turn.model.completed", fields);
}

export function logModelInvalid(logger: CommerceTurnLogger, modelStep: number, reasonCode: string) {
  safeLog(logger, "warn", "commerce.turn.model.invalid", { modelStep, reasonCode });
}
