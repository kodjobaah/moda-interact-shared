import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createMerchantKnowledgeProcessJobId,
} from "./merchant-knowledge.node.js";
import { MerchantKnowledgeProcessSourceRevisionJobSchema } from "./merchant-knowledge.js";

const identity = {
  shopId: "shop-1",
  sourceRevisionId: "revision-1",
  generation: 7,
};

test("creates the exact deterministic normalized SHA-256 queue job identity", () => {
  const id = createMerchantKnowledgeProcessJobId(identity);
  const expectedDigest = createHash("sha256")
    .update("shop-1\u001frevision-1\u001f7", "utf8")
    .digest("hex");
  assert.equal(id, `merchant-knowledge-process-${expectedDigest}`);
  assert.equal(id, createMerchantKnowledgeProcessJobId({
    shopId: "  shop-1 ",
    sourceRevisionId: " revision-1  ",
    generation: 7,
  }));
  assert.match(id, /^merchant-knowledge-process-[0-9a-f]{64}$/);
});

test("job identity includes shop, revision and generation but not requestedAt", () => {
  const base = createMerchantKnowledgeProcessJobId(identity);
  assert.notEqual(base, createMerchantKnowledgeProcessJobId({ ...identity, shopId: "shop-2" }));
  assert.notEqual(base, createMerchantKnowledgeProcessJobId({ ...identity, sourceRevisionId: "revision-2" }));
  assert.notEqual(base, createMerchantKnowledgeProcessJobId({ ...identity, generation: 8 }));

  const first = MerchantKnowledgeProcessSourceRevisionJobSchema.parse({
    schemaVersion: 1,
    ...identity,
    requestedAt: "2026-09-30T07:30:00Z",
  });
  const second = MerchantKnowledgeProcessSourceRevisionJobSchema.parse({
    ...first,
    requestedAt: "2026-09-30T09:30:00+02:00",
  });
  assert.equal(
    createMerchantKnowledgeProcessJobId(first),
    createMerchantKnowledgeProcessJobId(second),
  );
});

test("rejects invalid identity components", () => {
  for (const shopId of ["", "  ", "x".repeat(129)]) {
    assert.throws(() => createMerchantKnowledgeProcessJobId({ ...identity, shopId }));
  }
  for (const sourceRevisionId of ["", " \t ", "x".repeat(129)]) {
    assert.throws(() =>
      createMerchantKnowledgeProcessJobId({ ...identity, sourceRevisionId }),
    );
  }
  for (const generation of [0, -1, 1.5]) {
    assert.throws(() =>
      createMerchantKnowledgeProcessJobId({ ...identity, generation }),
    );
  }
});
