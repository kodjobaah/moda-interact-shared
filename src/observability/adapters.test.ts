import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createBullMQTelemetry } from "./bullmq.js";

type ReceivedRequest = {
  path: string;
  body: string;
};

test("BullMQ adapter is safe with global no-op providers", () => {
  assert.doesNotThrow(() => {
    const telemetry = createBullMQTelemetry({
      serviceName: "disabled-adapter-smoke",
      enableMetrics: false,
    });
    assert.equal(telemetry.meter, undefined);
    telemetry.tracer.startSpan("no-op").end();
  });
});

test("Prisma and BullMQ adapters emit joined traces and bounded metrics", async () => {
  const requests: ReceivedRequest[] = [];
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
  const fixtureDirectory = fileURLToPath(
    new URL("./test-fixtures/", import.meta.url),
  );
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const result = await spawnProcess(
    [
      "--import",
      "tsx",
      "--import",
      `${fixtureDirectory}adapters-preload.ts`,
      `${fixtureDirectory}adapters-app.ts`,
    ],
    {
      ...process.env,
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
  assert.match(result.stdout, /ADAPTER_SMOKE_OK/);

  const tracePayload = payloadFor(requests, "/v1/traces");
  assert.match(tracePayload, /prisma:client:findMany/);
  assert.match(tracePayload, /bullmq\.producer\.root/);
  assert.match(tracePayload, /add adapters\.queue/);
  assert.match(tracePayload, /process adapters\.queue/);

  const traceIds = [...tracePayload.matchAll(/"traceId":"([0-9a-f]{32})"/g)]
    .filter((match) => {
      const nearby = tracePayload.slice(match.index, match.index + 500);
      return /bullmq\.producer\.root|add adapters\.queue|process adapters\.queue/.test(nearby);
    })
    .map((match) => match[1]);
  assert.equal(new Set(traceIds).size, 1, "BullMQ spans must share one trace");

  const metricPayload = payloadFor(requests, "/v1/metrics");
  assert.match(metricPayload, /bullmq\.jobs\.completed/);
  assert.match(metricPayload, /bullmq\.queue\.name/);
  assert.match(metricPayload, /bullmq\.job\.name/);
  assert.match(metricPayload, /bullmq\.job\.state/);
  assert.doesNotMatch(metricPayload, /bullmq\.job\.id/);
  assert.doesNotMatch(metricPayload, /shopId|checkoutId|conversationId|messageId/);
});

function payloadFor(requests: ReceivedRequest[], path: string): string {
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