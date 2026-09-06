import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranslationBatchPollJobId,
  createTranslationBatchResultsJobId,
  createTranslationBatchSubmitJobId,
  createTranslationDispatchJobId,
  createTranslationReconcileJobId,
} from "./merchant-communications.node.js";

test("merchant communications job ids are deterministic and colon-free", () => {
  const dispatchId = createTranslationDispatchJobId("translation-1");
  assert.equal(dispatchId, createTranslationDispatchJobId("translation-1"));
  assert.notEqual(dispatchId, createTranslationDispatchJobId("translation-2"));
  assert.equal(dispatchId.includes(":"), false);
  assert.ok(dispatchId.startsWith("translation-dispatch-"));
});

test("poll ids include the durable poll sequence", () => {
  const firstPollId = createTranslationBatchPollJobId("batch-1", 1);
  const secondPollId = createTranslationBatchPollJobId("batch-1", 2);
  assert.notEqual(firstPollId, secondPollId);
  assert.equal(firstPollId, createTranslationBatchPollJobId("batch-1", 1));
});

test("each logical work type has a distinct deterministic identity", () => {
  const batchId = "batch-1";
  assert.notEqual(
    createTranslationBatchSubmitJobId(batchId),
    createTranslationBatchResultsJobId(batchId),
  );
  assert.equal(createTranslationReconcileJobId(), createTranslationReconcileJobId("periodic"));
  for (const jobId of [
    createTranslationBatchSubmitJobId(batchId),
    createTranslationBatchResultsJobId(batchId),
    createTranslationReconcileJobId("request-1"),
  ]) {
    assert.equal(jobId.includes(":"), false);
  }
});

test("rejects invalid identifiers and poll sequences", () => {
  assert.throws(() => createTranslationDispatchJobId(""));
  assert.throws(() => createTranslationBatchPollJobId("batch-1", -1));
  assert.throws(() => createTranslationBatchPollJobId("batch-1", 1.5));
});