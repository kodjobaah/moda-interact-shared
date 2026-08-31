import assert from "node:assert/strict";
import { context, ROOT_CONTEXT, trace, type Context } from "@opentelemetry/api";
import { createBullMQTelemetry } from "../bullmq.js";
import { getNodeObservabilityRuntime } from "../node.js";

type PrismaTracingHelper = {
  runInChildSpan<T>(
    options: { name: string; active?: boolean },
    callback: () => T,
  ): T;
};

const runtime = getNodeObservabilityRuntime();
assert.equal(runtime?.enabled, true);

const prismaAccessor = globalThis as typeof globalThis & {
  V6_PRISMA_INSTRUMENTATION?: { helper: PrismaTracingHelper };
};
assert.ok(prismaAccessor.V6_PRISMA_INSTRUMENTATION);
await prismaAccessor.V6_PRISMA_INSTRUMENTATION.helper.runInChildSpan(
  { name: "findMany", active: false },
  async () => {},
);

const telemetry = createBullMQTelemetry({
  serviceName: "observability-adapters-smoke",
  version: "1.0.0",
  enableMetrics: true,
});
assert.ok(telemetry.meter);

let propagatedMetadata = "";
await trace.getTracer("adapter-smoke").startActiveSpan(
  "bullmq.producer.root",
  async (rootSpan) => {
    const producerSpan = telemetry.tracer.startSpan(
      "add adapters.queue",
      { kind: 3 },
      context.active(),
    );
    const producerContext = producerSpan.setSpanOnContext(context.active());
    propagatedMetadata = telemetry.contextManager.getMetadata(producerContext);
    producerSpan.end();
    rootSpan.end();
  },
);

const consumerContext = telemetry.contextManager.fromMetadata(
  ROOT_CONTEXT as Context,
  propagatedMetadata,
);
const consumerSpan = telemetry.tracer.startSpan(
  "process adapters.queue",
  { kind: 4 },
  consumerContext,
);
consumerSpan.end();

const completed = telemetry.meter.createCounter("bullmq.jobs.completed", {
  unit: "1",
});
completed.add(1, {
  "bullmq.queue.name": "adapters.queue",
  "bullmq.job.name": "bounded-job-kind",
  "bullmq.job.state": "completed",
});

await runtime.forceFlush();
await runtime.shutdown();
console.log("ADAPTER_SMOKE_OK");