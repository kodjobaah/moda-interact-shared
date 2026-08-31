import assert from "node:assert/strict";
import test from "node:test";
import {
  context,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  observeAgentInvocation,
  observeAgentTool,
  observeConversationTurn,
} from "./genai.js";

test("GenAI helpers remain usable without an installed provider", async () => {
  const result = await observeConversationTurn("other", async () => "done");
  assert.equal(result, "done");
});

test("GenAI spans nest, inherit context, bound attributes, and report status", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);

  try {
    const tracer = trace.getTracer("genai-helper-test");
    const sensitivePayload = "SECRET_TOOL_PAYLOAD";
    const result = await observeConversationTurn("whatsapp", () =>
      observeAgentInvocation(
        {
          agentName: `  ${"agent".repeat(30)}  `,
          provider: "provider",
          model: "model",
        },
        () => observeAgentTool(` ${"tool".repeat(30)} `, async () => {
          assert.equal(sensitivePayload.length, 19);
          return tracer.startActiveSpan("auto-instrumented", (span) => {
            span.end();
            return "completed";
          });
        }),
      )
    );
    assert.equal(result, "completed");

    const expectedError = new Error("expected failure");
    await assert.rejects(
      observeConversationTurn("other", () =>
        observeAgentInvocation({ agentName: "failing-agent" }, () =>
          observeAgentTool("failing-tool", async () => {
            throw expectedError;
          })
        )
      ),
      (error) => error === expectedError,
    );

    const spans = exporter.getFinishedSpans();
    const turn = spanNamed(spans, "conversation.turn whatsapp");
    const agent = spans.find((span) => span.name.startsWith("invoke_agent "));
    const tool = spans.find((span) =>
      span.name.startsWith("execute_tool ") &&
      span.attributes["gen_ai.tool.name"] !== "failing-tool"
    );
    const automatic = spanNamed(spans, "auto-instrumented");
    const failed = spanNamed(spans, "execute_tool failing-tool");
    const failedAgent = spanNamed(spans, "invoke_agent failing-agent");
    const failedTurn = spanNamed(spans, "conversation.turn other");

    assert.ok(agent);
    assert.ok(tool);
    assert.equal(agent.parentSpanContext?.spanId, turn.spanContext().spanId);
    assert.equal(tool.parentSpanContext?.spanId, agent.spanContext().spanId);
    assert.equal(automatic.parentSpanContext?.spanId, tool.spanContext().spanId);
    assert.equal(new Set([turn, agent, tool, automatic].map(
      (span) => span.spanContext().traceId,
    )).size, 1);
    assert.equal(turn.status.code, SpanStatusCode.OK);
    assert.equal(agent.status.code, SpanStatusCode.OK);
    assert.equal(tool.status.code, SpanStatusCode.OK);
    assert.equal(failed.status.code, SpanStatusCode.ERROR);
    assert.equal(failedAgent.status.code, SpanStatusCode.ERROR);
    assert.equal(failedTurn.status.code, SpanStatusCode.ERROR);
    assert.equal(failed.events.some((event) => event.name === "exception"), true);
    assert.ok(String(agent.attributes["gen_ai.agent.name"]).length <= 80);
    assert.ok(String(tool.attributes["gen_ai.tool.name"]).length <= 80);
    const exportedData = spans.map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
    }));
    assert.doesNotMatch(JSON.stringify(exportedData), /SECRET_TOOL_PAYLOAD/);
  } finally {
    await provider.shutdown();
    context.disable();
    trace.disable();
  }
});

function spanNamed<T extends { name: string }>(spans: T[], name: string): T {
  const span = spans.find((candidate) => candidate.name === name);
  assert.ok(span, `missing span: ${name}`);
  return span;
}