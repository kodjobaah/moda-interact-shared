import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

type MetricPoint = {
  attributes: Record<string, unknown>;
  value: number | { count: number; sum?: number };
};

type Metric = {
  name: string;
  points: MetricPoint[];
};

const expectedMetricNames = [
  "moda.agent.invocation.duration_ms",
  "moda.agent.invocation.operations",
  "moda.agent.tool.duration_ms",
  "moda.agent.tool.operations",
  "moda.conversation.turn.duration_ms",
  "moda.conversation.turn.operations",
];

test("GenAI metrics have bounded attributes across fuzzed names and outcomes", async () => {
  const fixture = fileURLToPath(
    new URL("./test-fixtures/genai-metrics-app.ts", import.meta.url),
  );
  const result = await spawnProcess(["--import", "tsx", fixture]);

  assert.equal(result.code, 0, result.stderr);
  const serialized = result.stdout.match(/^GENAI_METRICS (.+)$/m)?.[1];
  assert.ok(serialized, result.stdout);
  const collected = JSON.parse(serialized) as Metric[];

  assert.deepEqual(
    collected.map((metric) => metric.name).sort(),
    [...expectedMetricNames].sort(),
  );

  for (const metric of collected) {
    assert.equal(metric.points.length, 2, `${metric.name} series count`);
    for (const point of metric.points) {
      const attributeNames = Object.keys(point.attributes).sort();
      const expectedNames = metric.name.startsWith("moda.conversation.turn")
        ? ["channel", "outcome"]
        : ["outcome"];
      assert.deepEqual(attributeNames, expectedNames);
      assert.match(String(point.attributes.outcome), /^(success|error)$/);
      if ("channel" in point.attributes) {
        assert.match(String(point.attributes.channel), /^(whatsapp|other)$/);
      }
    }
  }

  assertMetricCounts(collected, "moda.agent.invocation.duration_ms", 50, 1);
  assertMetricCounts(collected, "moda.agent.tool.duration_ms", 50, 1);
  assertMetricCounts(collected, "moda.conversation.turn.duration_ms", 1, 1);
  assertMetricCounts(collected, "moda.agent.invocation.operations", 50, 1);
  assertMetricCounts(collected, "moda.agent.tool.operations", 50, 1);
  assertMetricCounts(collected, "moda.conversation.turn.operations", 1, 1);

  assert.doesNotMatch(serialized, /SECRET_GENAI_PAYLOAD/);
  const serializedAttributes = JSON.stringify(
    collected.flatMap((metric) =>
      metric.points.map((point) => point.attributes)
    ),
  );
  assert.doesNotMatch(
    serializedAttributes,
    /agent|tool|provider|model|conversation|customer|message|job|recovery|checkout|shop/i,
  );
});

function assertMetricCounts(
  metrics: Metric[],
  name: string,
  success: number,
  error: number,
): void {
  const metric = metrics.find((candidate) => candidate.name === name);
  assert.ok(metric, `missing metric: ${name}`);
  assert.equal(pointCount(metric, "success"), success);
  assert.equal(pointCount(metric, "error"), error);
}

function pointCount(metric: Metric, outcome: "success" | "error"): number {
  const point = metric.points.find(
    (candidate) => candidate.attributes.outcome === outcome,
  );
  assert.ok(point, `${metric.name} missing ${outcome}`);
  return typeof point.value === "number" ? point.value : point.value.count;
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