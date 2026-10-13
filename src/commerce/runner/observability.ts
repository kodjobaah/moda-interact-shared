import type { LogFields, StructuredLogger } from "../../logging/index.js";
import type { PreparedCommerceTurn } from "./preflight.js";
import type { RunCommerceTurnInput, ModelResponseSummary } from "./types.js";

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

export function createRootTurnLogger(input: RunCommerceTurnInput): CommerceTurnLogger {
  try { return input.dependencies.logger; } catch { return undefined; }
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
    return input.dependencies.logger?.child(fields) ?? createRootTurnLogger(input);
  } catch {
    return createRootTurnLogger(input);
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

/** Defense in depth: log only finite, allowlisted telemetry even for custom invokers. */
function safeProviderSummary(summary: ModelResponseSummary | undefined): LogFields {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return {};
  const allowedReasons = ["stop", "length", "tool_calls", "content_filter", "other"];
  const allowedKinds = ["missing", "plain_text", "typed_blocks", "non_text_blocks"];
  return {
    ...(allowedReasons.includes(summary.finishReason ?? "") ? { providerFinishReason: summary.finishReason } : {}),
    ...(Number.isSafeInteger(summary.reasoningTokens) && summary.reasoningTokens! >= 0 && summary.reasoningTokens! <= 1_000_000_000
      ? { providerReasoningTokens: summary.reasoningTokens } : {}),
    ...(typeof summary.hasVisibleText === "boolean" ? { providerHasVisibleText: summary.hasVisibleText } : {}),
    ...(typeof summary.hasReasoningBlocks === "boolean" ? { providerHasReasoningBlocks: summary.hasReasoningBlocks } : {}),
    ...(allowedKinds.includes(summary.contentKind) ? { providerContentKind: summary.contentKind } : {}),
  };
}

export function logModelCompleted(
  logger: CommerceTurnLogger,
  fields: {
    modelStep: number;
    requestedToolCount: number;
    finalResponseRequested: boolean;
    outputTokens: number;
    durationMs: number;
    providerSummary?: ModelResponseSummary;
  },
) {
  const { providerSummary, ...ordinaryFields } = fields;
  safeLog(logger, "debug", "commerce.turn.model.completed", {
    ...ordinaryFields, ...safeProviderSummary(providerSummary),
  });
}

export function logModelInvalid(
  logger: CommerceTurnLogger,
  modelStep: number,
  reasonCode: string,
  providerSummary?: ModelResponseSummary,
) {
  safeLog(logger, "warn", "commerce.turn.model.invalid", {
    modelStep, reasonCode, ...safeProviderSummary(providerSummary),
  });
}
