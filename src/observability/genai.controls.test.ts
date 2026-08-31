import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

type Span = {
  name: string;
  spanId: string;
  parentSpanId?: string;
  status: number;
};

test("GenAI metric suppression retains active nested spans", async () => {
  const fixture = fileURLToPath(
    new URL("./test-fixtures/genai-spans-only-app.ts", import.meta.url),
  );
  const result = await spawnProcess(["--import", "tsx", fixture]);

  assert.equal(result.code, 0, result.stderr);
  const serialized = result.stdout.match(/^GENAI_SPANS_ONLY (.+)$/m)?.[1];
  assert.ok(serialized, result.stdout);
  const { metricNames, spans } = JSON.parse(serialized) as {
    metricNames: string[];
    spans: Span[];
  };

  assert.deepEqual(metricNames, []);
  assert.equal(spans.length, 3);
  const turn = spanNamed(spans, "conversation.turn whatsapp");
  const agent = spanNamed(spans, "invoke_agent commerce-agent");
  const tool = spanNamed(spans, "execute_tool search-products");
  assert.equal(agent.parentSpanId, turn.spanId);
  assert.equal(tool.parentSpanId, agent.spanId);
  assert.deepEqual(spans.map((span) => span.status), [1, 1, 1]);
});

function spanNamed(spans: Span[], name: string): Span {
  const span = spans.find((candidate) => candidate.name === name);
  assert.ok(span, `missing span: ${name}`);
  return span;
}

function spawnProcess(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}