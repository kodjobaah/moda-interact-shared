import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const redisUrl = process.env.TEST_REDIS_URL;

test("BullMQ Queue and Worker preserve trace context through native telemetry", {
  skip: redisUrl ? false : "TEST_REDIS_URL is not configured",
}, async () => {
  const requests: Array<{ path: string; body: string }> = [];
  const receiver = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body });
      response.statusCode = 200;
      response.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const fixtureDirectory = fileURLToPath(
    new URL("./test-fixtures/", import.meta.url),
  );

  const result = await spawnProcess(
    [
      "--import",
      "tsx",
      "--import",
      `${fixtureDirectory}adapters-preload.ts`,
      `${fixtureDirectory}bullmq-live-app.ts`,
    ],
    {
      ...process.env,
      TEST_REDIS_URL: redisUrl,
      OTEL_SDK_DISABLED: "false",
      OTEL_TRACES_SAMPLER: "always_on",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${baseUrl}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${baseUrl}/v1/metrics`,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
      LOKI_URL: undefined,
    },
  );
  await new Promise<void>((resolve, reject) => {
    receiver.close((error) => error ? reject(error) : resolve());
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /BULLMQ_LIVE_OK/);
  const tracePayload = payloadFor(requests, "/v1/traces");
  assert.match(tracePayload, /bullmq\.live\.root/);
  assert.match(tracePayload, /add shared-008-/);
  assert.match(tracePayload, /process shared-008-/);

  const rootTraceId = tracePayload.match(
    /"traceId":"([0-9a-f]{32})"[^}]*"name":"bullmq\.live\.root"/,
  )?.[1];
  assert.ok(rootTraceId);
  const matchingTraceSpans = tracePayload
    .split(`"traceId":"${rootTraceId}"`).length - 1;
  assert.ok(matchingTraceSpans >= 3, "root, producer, and worker must share a trace");

  const metricPayload = payloadFor(requests, "/v1/metrics");
  assert.match(metricPayload, /bullmq\.jobs\.completed/);
  assert.doesNotMatch(metricPayload, /bullmq\.job\.id/);
  assert.doesNotMatch(metricPayload, /shopId|checkoutId|conversationId|messageId/);
});

function payloadFor(
  requests: Array<{ path: string; body: string }>,
  path: string,
): string {
  return requests
    .filter((request) => request.path === path)
    .map((request) => request.body)
    .join("");
}

function spawnProcess(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env });
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