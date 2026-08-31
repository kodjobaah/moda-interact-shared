import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { metrics, trace } from "@opentelemetry/api";
import { createLogger } from "../../logging/index.js";
import {
  getNodeObservabilityRuntime,
} from "../node.js";

const runtime = getNodeObservabilityRuntime();
assert.equal(runtime?.enabled, true, "preload must initialize before app import");

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof import("node:http");

const logger = createLogger({
  serviceName: "observability-preload-smoke",
  environment: "production",
  sink: () => {},
});
const counter = metrics
  .getMeter("observability-preload-smoke")
  .createCounter("smoke.requests");

let correlatedTraceId: string | undefined;
const server = http.createServer((_request, response) => {
  correlatedTraceId = trace.getActiveSpan()?.spanContext().traceId;
  counter.add(1, { outcome: "ok" });
  logger.info("observability.preload.request", {
    outcome: "ok",
    authorization: "Bearer must-not-leak",
  });
  response.end("ok");
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");

await trace.getTracer("observability-preload-smoke").startActiveSpan(
  "smoke.parent",
  async (span) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/smoke?access_token=must-not-leak`,
    );
    assert.equal(await response.text(), "ok");

    const nativeBody = await new Promise<string>((resolve, reject) => {
      http.get(
        `http://127.0.0.1:${address.port}/native?api_key=must-not-leak`,
        (nativeResponse) => {
          let body = "";
          nativeResponse.setEncoding("utf8");
          nativeResponse.on("data", (chunk: string) => {
            body += chunk;
          });
          nativeResponse.on("end", () => resolve(body));
        },
      ).on("error", reject);
    });
    assert.equal(nativeBody, "ok");
    span.end();
  },
);

await new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

assert.match(correlatedTraceId ?? "", /^[0-9a-f]{32}$/);
await runtime.forceFlush();
await runtime.shutdown();

console.log(`SMOKE_RESULT:${JSON.stringify({ correlatedTraceId })}`);