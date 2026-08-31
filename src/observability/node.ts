import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import type { Span } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from "@opentelemetry/sdk-trace-base";
import {
  initNodeLokiLogging,
  initNodeOpenTelemetryLogging,
  type NodeLokiLoggingRuntime,
  type NodeOpenTelemetryLoggingRuntime,
} from "../logging/node.js";

const DEFAULT_NAMESPACE = "moda-interact";
const configurationWarnings = new Set<string>();

export type NodeInstrumentProfile = {
  http?: boolean;
  fetch?: boolean;
  prisma?: boolean;
};

export type NodeObservabilityOptions = {
  serviceName: string;
  environment?: string;
  serviceNamespace?: string;
  instrument?: NodeInstrumentProfile;
  traceSampleRatio?: number;
  forceEnable?: boolean;
};

export type NodeObservabilityRuntime = {
  enabled: boolean;
  serviceName: string;
  environment: string;
  error?: string;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

let runtime: NodeObservabilityRuntime | undefined;

export function resolveDeploymentEnvironmentName(): string {
  return nonEmpty(process.env.DEPLOYMENT_ENVIRONMENT_NAME)
    ?? nonEmpty(process.env.OTEL_DEPLOYMENT_ENVIRONMENT)
    ?? nonEmpty(process.env.NODE_ENV)
    ?? "development";
}

export function initNodeObservability(
  options: NodeObservabilityOptions,
): NodeObservabilityRuntime {
  if (runtime) {
    return runtime;
  }

  const serviceName = nonEmpty(options?.serviceName) ?? "unknown-service";
  const environment = nonEmpty(options?.environment)
    ?? resolveDeploymentEnvironmentName();
  const serviceNamespace = nonEmpty(options?.serviceNamespace)
    ?? DEFAULT_NAMESPACE;

  if (!nonEmpty(options?.serviceName)) {
    warnConfigurationOnce(
      "service-name",
      "observability disabled: serviceName must be non-empty",
    );
    runtime = disabledRuntime(serviceName, environment);
    return runtime;
  }

  const otelLogs = safeInitLogging(() => initNodeOpenTelemetryLogging({
    serviceName,
    environment,
    serviceNamespace,
  }), "OpenTelemetry Logs");
  const loki = safeInitLogging(() => initNodeLokiLogging({
    serviceName,
    environment,
    serviceNamespace,
  }), "Loki");

  if (!options.forceEnable && envBool("OTEL_SDK_DISABLED") === true) {
    runtime = disabledRuntime(serviceName, environment, otelLogs, loki);
    return runtime;
  }

  const traceEndpoint = signalEndpoint("TRACES", "traces");
  const metricEndpoint = signalEndpoint("METRICS", "metrics");

  if (!options.forceEnable && !traceEndpoint && !metricEndpoint) {
    runtime = disabledRuntime(serviceName, environment, otelLogs, loki);
    return runtime;
  }

  try {
    const resource = resourceFromAttributes({
      "service.namespace": serviceNamespace,
      "service.name": serviceName,
      "deployment.environment.name": environment,
    });
    const profile = options.instrument ?? {};
    const instrumentations = [
      ...(profile.http ? [new HttpInstrumentation({
        requestHook: (span, request) => {
          const path = "path" in request ? request.path : request.url;
          setSanitizedUrlAttributes(span, path);
          if (
            "protocol" in request
            && "host" in request
            && typeof request.protocol === "string"
            && typeof request.host === "string"
          ) {
            span.setAttribute(
              "url.full",
              `${request.protocol}//${request.host}${sanitizedPath(path ?? "/")}`,
            );
          }
        },
      })] : []),
      ...(profile.fetch ? [new UndiciInstrumentation({
        requestHook: (span, request) => {
          const path = sanitizedPath(request.path);
          span.setAttribute("url.path", path);
          span.setAttribute("url.full", `${request.origin}${path}`);
          span.setAttribute("url.query", "");
        },
      })] : []),
      ...(profile.prisma ? [new PrismaInstrumentation()] : []),
    ];

    const traceProcessor = createTraceProcessor(traceEndpoint);
    const metricReader = createMetricReader(metricEndpoint);

    if (!traceProcessor && !metricReader) {
      runtime = {
        ...disabledRuntime(serviceName, environment, otelLogs, loki),
        error: "observability-exporters-unavailable",
      };
      return runtime;
    }

    const sdk = new NodeSDK({
      resource,
      autoDetectResources: false,
      sampler: resolveSampler(options.traceSampleRatio, environment),
      spanProcessors: traceProcessor ? [traceProcessor] : [],
      ...(metricReader ? { metricReader } : {}),
      instrumentations,
    });

    sdk.start();

    let shutdownPromise: Promise<void> | undefined;
    runtime = {
      enabled: true,
      serviceName,
      environment,
      forceFlush: async () => {
        await Promise.allSettled([
          traceProcessor?.forceFlush(),
          metricReader?.forceFlush(),
          otelLogs?.forceFlush(),
          loki?.forceFlush(),
        ]);
      },
      shutdown: () => {
        shutdownPromise ??= settleAll([
          Promise.resolve(sdk.shutdown()),
          otelLogs?.shutdown(),
          loki?.shutdown(),
        ]);
        return shutdownPromise;
      },
    };
    return runtime;
  } catch (error) {
    warnConfigurationOnce(
      "runtime-init",
      "observability disabled: Node runtime initialization failed",
    );
    runtime = {
      ...disabledRuntime(serviceName, environment, otelLogs, loki),
      error: boundedError(error),
    };
    return runtime;
  }
}

export function getNodeObservabilityRuntime():
  | NodeObservabilityRuntime
  | undefined {
  return runtime;
}

export function resolveSampler(
  explicitRatio: number | undefined,
  environment: string,
): Sampler {
  const fallbackRatio = environment === "test" ? 1 : 0.1;

  if (explicitRatio !== undefined) {
    if (!Number.isFinite(explicitRatio) || explicitRatio < 0 || explicitRatio > 1) {
      warnConfigurationOnce(
        "explicit-sampler-ratio",
        "invalid traceSampleRatio; using the Moda environment fallback",
      );
      return parentBasedRatio(fallbackRatio);
    }
    return parentBasedRatio(explicitRatio);
  }

  const requested = nonEmpty(process.env.OTEL_TRACES_SAMPLER)?.toLowerCase();
  if (!requested) {
    return parentBasedRatio(fallbackRatio);
  }

  switch (requested) {
    case "always_on":
      return new AlwaysOnSampler();
    case "always_off":
      return new AlwaysOffSampler();
    case "traceidratio":
      return new TraceIdRatioBasedSampler(samplerRatioArg(fallbackRatio));
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return parentBasedRatio(samplerRatioArg(fallbackRatio));
    default:
      warnConfigurationOnce(
        "unsupported-sampler",
        "unsupported OTEL_TRACES_SAMPLER; using the Moda environment fallback",
      );
      return parentBasedRatio(fallbackRatio);
  }
}

function createTraceProcessor(
  endpoint: string | undefined,
): BatchSpanProcessor | undefined {
  if (!endpoint) {
    return undefined;
  }

  try {
    return new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: endpoint,
        concurrencyLimit: positiveInt("OTEL_EXPORTER_OTLP_TRACES_CONCURRENCY_LIMIT", 2),
      }),
      {
        maxQueueSize: positiveInt("OTEL_BSP_MAX_QUEUE_SIZE", 2048),
        maxExportBatchSize: positiveInt("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 512),
        scheduledDelayMillis: positiveInt("OTEL_BSP_SCHEDULE_DELAY", 5_000),
        exportTimeoutMillis: positiveInt("OTEL_BSP_EXPORT_TIMEOUT", 30_000),
      },
    );
  } catch {
    warnConfigurationOnce(
      "trace-exporter",
      "trace exporter unavailable; trace export disabled",
    );
    return undefined;
  }
}

function createMetricReader(
  endpoint: string | undefined,
): PeriodicExportingMetricReader | undefined {
  if (!endpoint) {
    return undefined;
  }

  try {
    const interval = positiveInt("OTEL_METRIC_EXPORT_INTERVAL", 60_000);
    const timeout = Math.min(
      positiveInt("OTEL_METRIC_EXPORT_TIMEOUT", 30_000),
      interval,
    );

    return new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: endpoint,
        concurrencyLimit: positiveInt("OTEL_EXPORTER_OTLP_METRICS_CONCURRENCY_LIMIT", 2),
      }),
      exportIntervalMillis: interval,
      exportTimeoutMillis: timeout,
    });
  } catch {
    warnConfigurationOnce(
      "metric-exporter",
      "metric exporter unavailable; metric export disabled",
    );
    return undefined;
  }
}

function samplerRatioArg(fallback: number): number {
  const raw = nonEmpty(process.env.OTEL_TRACES_SAMPLER_ARG);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    warnConfigurationOnce(
      "sampler-ratio-arg",
      "invalid OTEL_TRACES_SAMPLER_ARG; using the Moda environment fallback",
    );
    return fallback;
  }
  return value;
}

function parentBasedRatio(ratio: number): ParentBasedSampler {
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}

function disabledRuntime(
  serviceName: string,
  environment: string,
  otelLogs?: NodeOpenTelemetryLoggingRuntime,
  loki?: NodeLokiLoggingRuntime,
): NodeObservabilityRuntime {
  let shutdownPromise: Promise<void> | undefined;

  return {
    enabled: false,
    serviceName,
    environment,
    forceFlush: () => settleAll([
      otelLogs?.forceFlush(),
      loki?.forceFlush(),
    ]),
    shutdown: () => {
      shutdownPromise ??= settleAll([
        otelLogs?.shutdown(),
        loki?.shutdown(),
      ]);
      return shutdownPromise;
    },
  };
}

function safeInitLogging<T>(fn: () => T, destination: string): T | undefined {
  try {
    return fn();
  } catch {
    warnConfigurationOnce(
      `logging-${destination}`,
      `${destination} initialization failed; destination disabled`,
    );
    return undefined;
  }
}

async function settleAll(
  operations: Array<Promise<unknown> | undefined>,
): Promise<void> {
  await Promise.allSettled(operations);
}

function warnConfigurationOnce(key: string, message: string): void {
  if (configurationWarnings.has(key)) {
    return;
  }
  configurationWarnings.add(key);

  try {
    console.warn(`[moda-observability] ${message.slice(0, 240)}`);
  } catch {
    // Configuration diagnostics must not affect application startup.
  }
}

function boundedError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 300)
    : "observability-init-failed";
}

function setSanitizedUrlAttributes(
  span: Span,
  requestPath: string | undefined,
): void {
  if (!requestPath) {
    return;
  }
  span.setAttribute("url.path", sanitizedPath(requestPath));
  span.setAttribute("url.query", "");
}

function sanitizedPath(value: string): string {
  return value.split(/[?#]/, 1)[0] || "/";
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function envBool(name: string): boolean | undefined {
  const value = nonEmpty(process.env[name])?.toLowerCase();
  if (["true", "1", "yes", "on"].includes(value ?? "")) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(value ?? "")) {
    return false;
  }
  return undefined;
}

function positiveInt(name: string, fallback: number): number {
  const raw = nonEmpty(process.env[name]);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function signalEndpoint(
  signal: "TRACES" | "METRICS",
  suffix: string,
): string | undefined {
  const exporter = nonEmpty(process.env[`OTEL_${signal}_EXPORTER`]);
  if (exporter && exporter.toLowerCase() !== "otlp") {
    return undefined;
  }

  const exact = nonEmpty(process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]);
  if (exact) {
    return exact;
  }

  const base = nonEmpty(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
    ?.replace(/\/+$/, "");
  return base ? `${base}/v1/${suffix}` : undefined;
}