import type { CommerceFinalResponse } from "../response.js";
import type { CommerceEvidence } from "../schemas.js";
import { RunnerFailure } from "./failure.js";
import { schemaIssueMetadata } from "./diagnostics.js";
import type { PreparedCommerceTurn } from "./preflight.js";

export function validateFinalResponse(input: {
  raw: unknown;
  prepared: PreparedCommerceTurn;
  evidenceById: Readonly<Record<string, CommerceEvidence>>;
  requiredReferral: CommerceFinalResponse["referralReason"];
  languageSource: string | null;
  remoteCalls: number;
  now: () => number;
  checkCancellationAndDeadline(): void;
}): CommerceFinalResponse {
  const parsed = input.prepared.finalSchema.safeParse(input.raw);
  if (!parsed.success) throw new RunnerFailure("INVALID_FINAL", {
    stage: "final.validate", reasonCode: "FINAL_SCHEMA_INVALID", ...schemaIssueMetadata(parsed.error),
  }, parsed.error);
  const final = parsed.data;
  if (input.languageSource === "customer-explicit" && final.detectedLanguageTag !== null)
    throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_LANGUAGE_MISMATCH" });
  if (input.requiredReferral && final.answerKind !== "REFER_TO_STORE")
    throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_REFERRAL_REQUIRED" });
  if (input.remoteCalls + final.evidenceIds.length > input.prepared.budgets.remoteCalls)
    throw new RunnerFailure("BUDGET_EXHAUSTED", {
      stage: "final.validate", reasonCode: "EVIDENCE_RESERVATION_EXCEEDED",
    });
  for (const evidenceId of final.evidenceIds) {
    const evidence = input.evidenceById[evidenceId];
    if (!evidence || evidence.outcome !== "QUALIFIES_FOR_KNOWN_RULES")
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_EVIDENCE_INVALID" });
    if (Date.parse(evidence.expiresAt) <= input.now())
      throw new RunnerFailure("INVALID_FINAL", { stage: "final.validate", reasonCode: "FINAL_EVIDENCE_EXPIRED" });
  }
  input.checkCancellationAndDeadline();
  return final;
}
