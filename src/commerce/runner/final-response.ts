import type { CommerceFinalResponse } from "../response.js";
import type { CommerceEvidence } from "../schemas.js";
import { RunnerFailure } from "./failure.js";
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
  if (!parsed.success) throw new RunnerFailure("INVALID_FINAL");
  const final = parsed.data;
  if (input.languageSource === "customer-explicit" && final.detectedLanguageTag !== null)
    throw new RunnerFailure("INVALID_FINAL");
  if (input.requiredReferral && final.answerKind !== "REFER_TO_STORE")
    throw new RunnerFailure("INVALID_FINAL");
  if (input.remoteCalls + final.evidenceIds.length > input.prepared.budgets.remoteCalls)
    throw new RunnerFailure("BUDGET_EXHAUSTED");
  for (const evidenceId of final.evidenceIds) {
    const evidence = input.evidenceById[evidenceId];
    if (
      !evidence || evidence.outcome !== "QUALIFIES_FOR_KNOWN_RULES" ||
      Date.parse(evidence.expiresAt) <= input.now()
    ) throw new RunnerFailure("INVALID_FINAL");
  }
  input.checkCancellationAndDeadline();
  return final;
}