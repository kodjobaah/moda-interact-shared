import { canonicalJson } from "../canonical-json.js";
import { CommerceEvidenceSchema, type CommerceEvidence, type CommerceToolResult } from "../schemas.js";
import { RunnerFailure } from "./failure.js";
import type { CommerceTurnRuntime } from "./runtime.js";
import type { PreparedCommerceTurn } from "./preflight.js";
import type { RunCommerceTurnInput, RunnerTool } from "./types.js";
import { safeLog, type CommerceTurnLogger } from "./observability.js";

export function collectVerifiedEvidence(input: {
  source: RunCommerceTurnInput;
  prepared: PreparedCommerceTurn;
  runtime: CommerceTurnRuntime;
  tool: RunnerTool;
  toolName: string;
  result: CommerceToolResult;
  modelStep: number;
  logger: CommerceTurnLogger;
}): CommerceEvidence[] {
  const { result, tool } = input;
  if (
    result.status !== "OK" ||
    (result.data && typeof result.data === "object" && "source" in result.data &&
      result.data.source === "SHOPIFY_STOREFRONT")
  ) return [];
  const accepted: CommerceEvidence[] = [];
  for (const raw of tool.extractEvidence?.(result) ?? []) {
    const evidence = CommerceEvidenceSchema.parse(raw);
    const { evidenceId, ...hashInput } = evidence;
    if (
      canonicalJson(evidence.turn) !== canonicalJson(input.prepared.turn) ||
      evidence.grantId !== input.prepared.grant.id ||
      evidence.releaseId !== input.prepared.grant.releaseId ||
      input.source.dependencies.digest(canonicalJson(hashInput)) !== evidenceId ||
      Date.parse(evidence.evaluatedAt) > input.source.dependencies.now()
    ) throw new RunnerFailure("INVALID_FINAL");
    accepted.push(evidence);
  }
  if (accepted.length > 0) {
    safeLog(input.logger, "debug", "commerce.turn.evidence.accepted", {
      modelStep: input.modelStep,
      toolName: input.toolName,
      evidenceCount: accepted.length,
    });
  }
  return accepted;
}