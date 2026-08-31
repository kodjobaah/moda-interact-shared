import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

type ReceivedRequest = {
  path: string;
  body: Buffer;
};

test("preload exports HTTP, fetch, metrics, correlated logs, and Loki", async () => {
  const requests: ReceivedRequest[] = [];
  const receiver = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        path: request.url ?? "",
        body: Buffer.concat(chunks),
      });
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

  const childResult = await spawnProcess(
    [
      "--import",
      "tsx",
      "--import",
      `${fixtureDirectory}preload.ts`,
      `${fixtureDirectory}app.ts`,
    ],
    {
      ...process.env,
      OTEL_SDK_DISABLED: "false",
      OTEL_TRACES_SAMPLER: "always_on",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${baseUrl}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${baseUrl}/v1/metrics`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${baseUrl}/v1/logs`,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
      OTEL_METRIC_EXPORT_TIMEOUT: "5000",
      LOKI_URL: baseUrl,
      LOKI_BATCHING: "false",
    },
  );

  await new Promise<void>((resolve, reject) => {
    receiver.close((error) => error ? reject(error) : resolve());
  });

  assert.equal(childResult.code, 0, childResult.stderr);
  const resultLine = childResult.stdout
    .split("\n")
    .find((line) => line.startsWith("SMOKE_RESULT:"));
  assert.ok(resultLine, childResult.stdout);
  const result = JSON.parse(resultLine.slice("SMOKE_RESULT:".length)) as {
    correlatedTraceId: string;
  };

  const receivedPaths = new Set(requests.map((request) => request.path));
  assert.ok(receivedPaths.has("/v1/traces"), "trace forceFlush missing");
  assert.ok(receivedPaths.has("/v1/metrics"), "metric forceFlush missing");
  assert.ok(receivedPaths.has("/v1/logs"), "OTel Log forceFlush missing");
  assert.ok(
    receivedPaths.has("/loki/api/v1/push"),
    "Loki forceFlush missing",
  );

  const tracePayload = combinedBody(requests, "/v1/traces");
  assert.match(tracePayload, /smoke\.parent/);
  assert.match(tracePayload, /\/smoke/);
  assert.match(tracePayload, /GET/);
  assert.match(tracePayload, /observability-preload-smoke/);
  assert.match(tracePayload, /production/);

  const logPayload = combinedBody(requests, "/v1/logs");
  assert.match(logPayload, /observability\.preload\.request/);
  assert.match(logPayload, new RegExp(result.correlatedTraceId));

  const allPayloads = Buffer.concat(requests.map((request) => request.body))
    .toString("utf8");
  assert.doesNotMatch(allPayloads, /must-not-leak/);
});

test("invalid metric configuration does not abort trace initialization", async () => {
  const requests: ReceivedRequest[] = [];
  const receiver = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body: Buffer.concat(chunks) });
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

  const childResult = await spawnProcess(
    [
      "--import",
      "tsx",
      "--import",
      `${fixtureDirectory}preload.ts`,
      `${fixtureDirectory}failure-app.ts`,
    ],
    isolatedEnvironment({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
        `http://127.0.0.1:${address.port}/v1/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "://invalid-metric-endpoint",
    }),
  );

  await new Promise<void>((resolve, reject) => {
    receiver.close((error) => error ? reject(error) : resolve());
  });

  assert.equal(childResult.code, 0, childResult.stderr);
  assert.match(childResult.stdout, /FAILURE_ISOLATION_OK/);
  assert.ok(requests.some((request) => request.path === "/v1/traces"));
  assert.match(combinedBody(requests, "/v1/traces"), /failure-isolation\.parent/);
});

test("unavailable exporters do not escape forceFlush or shutdown", async () => {
  const fixtureDirectory = fileURLToPath(
    new URL("./test-fixtures/", import.meta.url),
  );
  const childResult = await spawnProcess(
    [
      "--import",
      "tsx",
      "--import",
      `${fixtureDirectory}preload.ts`,
      `${fixtureDirectory}failure-app.ts`,
    ],
    isolatedEnvironment({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:1/v1/traces",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://127.0.0.1:1/v1/metrics",
      OTEL_BSP_EXPORT_TIMEOUT: "100",
      OTEL_METRIC_EXPORT_TIMEOUT: "100",
      OTEL_METRIC_EXPORT_INTERVAL: "100",
    }),
  );

  assert.equal(childResult.code, 0, childResult.stderr);
  assert.match(childResult.stdout, /FAILURE_ISOLATION_OK/);
});

function combinedBody(requests: ReceivedRequest[], path: string): string {
  return Buffer.concat(
    requests
      .filter((request) => request.path === path)
      .map((request) => request.body),
  ).toString("utf8");
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

function isolatedEnvironment(
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OTEL_SDK_DISABLED: "false",
    OTEL_TRACES_SAMPLER: "always_on",
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
    LOKI_URL: undefined,
    ...overrides,
  };
}