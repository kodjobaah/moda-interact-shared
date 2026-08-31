import assert from "node:assert/strict";
import { trace } from "@opentelemetry/api";
import { Queue, Worker } from "bullmq";
import { createBullMQTelemetry } from "../bullmq.js";
import { getNodeObservabilityRuntime } from "../node.js";

const redisUrl = process.env.TEST_REDIS_URL;
assert.ok(redisUrl);
const connection = { url: redisUrl, maxRetriesPerRequest: null };
const queueName = `shared-008-${process.pid}`;
const telemetry = createBullMQTelemetry({
  serviceName: "observability-adapters-smoke",
  enableMetrics: true,
});
const runtime = getNodeObservabilityRuntime();
assert.equal(runtime?.enabled, true);

const queue = new Queue(queueName, { connection, telemetry });
let complete: (() => void) | undefined;
let fail: ((error: Error) => void) | undefined;
const completed = new Promise<void>((resolve, reject) => {
  complete = resolve;
  fail = reject;
});
const worker = new Worker(
  queueName,
  async () => "done",
  { connection, telemetry },
);
worker.once("completed", () => complete?.());
worker.once("failed", (_job, error) => fail?.(error));

await worker.waitUntilReady();
await trace.getTracer("bullmq-live-smoke").startActiveSpan(
  "bullmq.live.root",
  async (span) => {
    await queue.add("bounded-live-job", { safe: true });
    await completed;
    span.end();
  },
);

await worker.close();
await queue.obliterate({ force: true });
await queue.close();
await runtime.forceFlush();
await runtime.shutdown();
console.log("BULLMQ_LIVE_OK");