import assert from "node:assert/strict";
import { trace } from "@opentelemetry/api";
import { getNodeObservabilityRuntime } from "../node.js";

const runtime = getNodeObservabilityRuntime();
assert.equal(runtime?.enabled, true, "trace pipeline should remain enabled");

const span = trace.getTracer("observability-failure-smoke").startSpan(
  "failure-isolation.parent",
);
span.end();

await runtime.forceFlush();
await runtime.shutdown();
console.log("FAILURE_ISOLATION_OK");