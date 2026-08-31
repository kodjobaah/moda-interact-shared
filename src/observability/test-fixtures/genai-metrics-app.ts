import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 60_000,
});
const provider = new MeterProvider({ readers: [reader] });
metrics.setGlobalMeterProvider(provider);

const {
  observeAgentInvocation,
  observeAgentTool,
  observeConversationTurn,
} = await import("../genai.js");

const sensitiveValue = "SECRET_GENAI_PAYLOAD";

for (let index = 0; index < 50; index += 1) {
  await observeAgentInvocation(
    {
      agentName: `agent-${index}-${sensitiveValue}`,
      provider: `provider-${index}-${sensitiveValue}`,
      model: `model-${index}-${sensitiveValue}`,
    },
    async () => "done",
  );
  await observeAgentTool(
    `tool-${index}-${sensitiveValue}`,
    async () => "done",
  );
}

await observeConversationTurn("whatsapp", async () => "done");

for (const operation of [
  () => observeAgentInvocation(
    { agentName: `failed-agent-${sensitiveValue}` },
    async () => Promise.reject(new Error("expected")),
  ),
  () => observeAgentTool(
    `failed-tool-${sensitiveValue}`,
    async () => Promise.reject(new Error("expected")),
  ),
  () => observeConversationTurn(
    "other",
    async () => Promise.reject(new Error("expected")),
  ),
]) {
  try {
    await operation();
  } catch {
    // Expected application failures are measured and remain rethrown.
  }
}

await provider.forceFlush();

const collected = exporter.getMetrics().flatMap((resourceMetrics) =>
  resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
    scopeMetrics.metrics.map((metric) => ({
      name: metric.descriptor.name,
      points: metric.dataPoints.map((point) => ({
        attributes: point.attributes,
        value: point.value,
      })),
    }))
  )
);

console.log(`GENAI_METRICS ${JSON.stringify(collected)}`);
await provider.shutdown();