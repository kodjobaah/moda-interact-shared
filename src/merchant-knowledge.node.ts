import { createHash } from "node:crypto";

import type { MerchantKnowledgeProcessSourceRevisionJob } from "./merchant-knowledge.js";

export function createMerchantKnowledgeProcessJobId(
  input: Pick<
    MerchantKnowledgeProcessSourceRevisionJob,
    "shopId" | "sourceRevisionId" | "generation"
  >,
): string {
  const shopId = input.shopId.trim();
  const sourceRevisionId = input.sourceRevisionId.trim();
  if (!shopId || shopId.length > 128) {
    throw new TypeError("shopId must be non-empty and at most 128 characters");
  }
  if (!sourceRevisionId || sourceRevisionId.length > 128) {
    throw new TypeError("sourceRevisionId must be non-empty and at most 128 characters");
  }
  if (!Number.isInteger(input.generation) || input.generation <= 0) {
    throw new TypeError("generation must be a positive integer");
  }

  const identity = `${shopId}\u001f${sourceRevisionId}\u001f${input.generation}`;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `merchant-knowledge-process-${digest}`;
}
