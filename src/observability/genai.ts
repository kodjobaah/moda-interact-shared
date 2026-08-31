import { metrics, type Attributes, type Counter, type Histogram } from "@opentelemetry/api";
import {
  withObservedSpan,
  type ObservedSpanOptions,
} from "./index.js";

export type {
  ObservedSpanOptions,
  SpanExceptionMapper,
} from "./index.js";

const MAX_ATTRIBUTE_LENGTH = 80;
const meter = metrics.getMeter(
  "@modainteract/moda-interact-shared/observability/genai",
);
const agentDuration = meter.createHistogram(
  "moda.agent.invocation.duration_ms",
  { unit: "ms" },
);
const agentOperations = meter.createCounter("moda.agent.invocation.operations");
const toolDuration = meter.createHistogram("moda.agent.tool.duration_ms", {
  unit: "ms",
});
const toolOperations = meter.createCounter("moda.agent.tool.operations");
const turnDuration = meter.createHistogram(
  "moda.conversation.turn.duration_ms",
  { unit: "ms" },
);
const turnOperations = meter.createCounter("moda.conversation.turn.operations");

type Outcome = "success" | "error";

export type AgentObservation = {
  agentName: string;
  provider?: string;
  model?: string;
};

export type GenAIObservationOptions = ObservedSpanOptions & {
  recordMetrics?: boolean;
};

export async function observeConversationTurn<T>(
  channel: "whatsapp" | "other",
  work: () => Promise<T>,
  options: GenAIObservationOptions = {},
): Promise<T> {
  const observeSpan = () => withObservedSpan(
    `conversation.turn ${channel}`,
    { "moda.messaging.channel": channel },
    work,
    options,
  );

  return observeGenAIOperation(
    turnDuration,
    turnOperations,
    { channel },
    observeSpan,
    options,
  );
}

export async function observeAgentInvocation<T>(
  observation: AgentObservation,
  work: () => Promise<T>,
  options: GenAIObservationOptions = {},
): Promise<T> {
  const agentName = boundedSpanValue(observation.agentName) ?? "unknown";

  const observeSpan = () => withObservedSpan(
    `invoke_agent ${agentName}`,
    compact({
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": agentName,
      "gen_ai.provider.name": boundedSpanValue(observation.provider),
      "gen_ai.request.model": boundedSpanValue(observation.model),
    }),
    work,
    options,
  );

  return observeGenAIOperation(
    agentDuration,
    agentOperations,
    {},
    observeSpan,
    options,
  );
}

export async function observeAgentTool<T>(
  toolName: string,
  work: () => Promise<T>,
  options: GenAIObservationOptions = {},
): Promise<T> {
  const safeToolName = boundedSpanValue(toolName) ?? "unknown";

  const observeSpan = () => withObservedSpan(
    `execute_tool ${safeToolName}`,
    {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": safeToolName,
    },
    work,
    options,
  );

  return observeGenAIOperation(
    toolDuration,
    toolOperations,
    {},
    observeSpan,
    options,
  );
}

function observeGenAIOperation<T>(
  duration: Histogram,
  operations: Counter,
  attributes: Attributes,
  work: () => Promise<T>,
  options: GenAIObservationOptions,
): Promise<T> {
  return options.recordMetrics === false
    ? work()
    : observeOperation(duration, operations, attributes, work);
}

async function observeOperation<T>(
  duration: Histogram,
  operations: Counter,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let outcome: Outcome = "error";

  try {
    const result = await work();
    outcome = "success";
    return result;
  } finally {
    recordMetrics(duration, operations, performance.now() - started, {
      ...attributes,
      outcome,
    });
  }
}

function recordMetrics(
  duration: Histogram,
  operations: Counter,
  elapsedMilliseconds: number,
  attributes: Attributes,
): void {
  try {
    duration.record(elapsedMilliseconds, attributes);
    operations.add(1, attributes);
  } catch {
    // Telemetry must not replace an application result or error.
  }
}

function boundedSpanValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const bounded = value.trim().slice(0, MAX_ATTRIBUTE_LENGTH);
  return bounded || undefined;
}

function compact(
  attributes: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, string] =>
      entry[1] !== undefined
    ),
  );
}