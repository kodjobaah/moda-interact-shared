import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const metricExporter = new InMemoryMetricExporter(
  AggregationTemporality.CUMULATIVE,
);
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60_000,
});
const meterProvider = new MeterProvider({ readers: [metricReader] });
metrics.setGlobalMeterProvider(meterProvider);

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const contextManager = new AsyncLocalStorageContextManager().enable();
context.setGlobalContextManager(contextManager);
trace.setGlobalTracerProvider(tracerProvider);

const {
  observeAgentInvocation,
  observeAgentTool,
  observeConversationTurn,
} = await import("../genai.js");

const controls = {
  recordMetrics: false,
  mapException: () => ({
    name: "SafeFailure",
    message: "Observed operation failed",
  }),
} as const;

await observeConversationTurn(
  "whatsapp",
  () => observeAgentInvocation(
    { agentName: "commerce-agent", provider: "provider", model: "model" },
    () => observeAgentTool("search-products", async () => "done", controls),
    controls,
  ),
  controls,
);

await meterProvider.forceFlush();
await tracerProvider.forceFlush();

const metricNames = metricExporter.getMetrics().flatMap((resourceMetrics) =>
  resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
    scopeMetrics.metrics.map((metric) => metric.descriptor.name)
  )
);
const spans = spanExporter.getFinishedSpans().map((span) => ({
  name: span.name,
  spanId: span.spanContext().spanId,
  parentSpanId: span.parentSpanContext?.spanId,
  status: span.status.code,
}));

console.log(`GENAI_SPANS_ONLY ${JSON.stringify({ metricNames, spans })}`);

await meterProvider.shutdown();
await tracerProvider.shutdown();
context.disable();
trace.disable();