import { createHash } from "node:crypto";

function createMerchantCommunicationsJobId(prefix: string, ...parts: string[]): string {
  if (parts.some((part) => typeof part !== "string" || part.length === 0)) {
    throw new Error(`${prefix}: identifiers must be non-empty strings`);
  }

  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex");
  return `${prefix}-${digest}`;
}

export function createTranslationDispatchJobId(translationId: string): string {
  return createMerchantCommunicationsJobId("translation-dispatch", translationId);
}

export function createTranslationBatchSubmitJobId(translationBatchId: string): string {
  return createMerchantCommunicationsJobId("translation-batch-submit", translationBatchId);
}

export function createTranslationBatchPollJobId(
  translationBatchId: string,
  pollSequence: number,
): string {
  if (!Number.isInteger(pollSequence) || pollSequence < 0) {
    throw new Error("translation-batch-poll: poll sequence must be a non-negative integer");
  }

  return createMerchantCommunicationsJobId(
    "translation-batch-poll",
    translationBatchId,
    String(pollSequence),
  );
}

export function createTranslationBatchResultsJobId(translationBatchId: string): string {
  return createMerchantCommunicationsJobId("translation-batch-results", translationBatchId);
}

export function createTranslationReconcileJobId(reconciliationRequestId = "periodic"): string {
  return createMerchantCommunicationsJobId("translation-reconcile", reconciliationRequestId);
}