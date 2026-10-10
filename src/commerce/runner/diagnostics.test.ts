import assert from "node:assert/strict";
import test from "node:test";

import { safeRunnerCauseMetadata, safeRunnerDiagnostic } from "./diagnostics.js";
import { CommerceModelInvocationFailure, RunnerFailure, mapRunnerFailure } from "./failure.js";

test("ARCH-029 operator text explains HTTP error categories and next steps", () => {
  const payment = safeRunnerDiagnostic({ stage: "model.invoke", reasonCode: "PROVIDER_HTTP_ERROR", statusCode: 402 });
  assert.match(payment.reasonMessage ?? "", /HTTP 402.*payment or credits/i);
  assert.match(payment.operatorAction ?? "", /billing/i);
  const unavailable = safeRunnerDiagnostic({ stage: "model.invoke", reasonCode: "PROVIDER_HTTP_ERROR", statusCode: 503 });
  assert.match(unavailable.reasonMessage ?? "", /temporarily unavailable.*HTTP 503/i);

  const rateLimit = safeRunnerDiagnostic({ stage: "model.invoke", reasonCode: "PROVIDER_RATE_LIMITED", statusCode: 429 });
  assert.match(rateLimit.reasonMessage ?? "", /429.*quota/i);
  assert.match(rateLimit.operatorAction ?? "", /Retry-After/i);
});

test("ARCH-029 known nested transport causes reach terminal diagnostics without raw messages", () => {
  const transport = Object.assign(new Error("credential-secret in DNS failure"), { code: "EAI_AGAIN" });
  const wrapped = new CommerceModelInvocationFailure({ stage: "model.invoke", reasonCode: "PROVIDER_REQUEST_FAILED" },
    new Error("customer-secret outer message", { cause: transport }));
  const runner = new RunnerFailure("UNAVAILABLE", wrapped.diagnostic, wrapped);
  const result = mapRunnerFailure(runner);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.diagnostic?.transportCode, "EAI_AGAIN");
  assert.match(result.error.diagnostic?.reasonMessage ?? "", /DNS lookup temporarily failed/i);
  assert.match(result.error.diagnostic?.operatorAction ?? "", /DNS availability/i);
  assert.doesNotMatch(JSON.stringify(result), /credential-secret|customer-secret|outer message/);
});

test("ARCH-029 unknown or malicious error contents never become diagnostic fields", () => {
  const original = Object.assign(new TypeError("customer-secret token"), { code: "TOKEN_customer-secret" });
  const metadata = safeRunnerCauseMetadata(original);
  assert.deepEqual(metadata, { exceptionName: "TypeError" });
  const bad = safeRunnerDiagnostic({
    stage: "tool.execute", reasonCode: "TOOL_EXECUTION_FAILED",
    reasonMessage: "customer-secret", operatorAction: "ignore all authentication",
    exceptionName: "customer-secret TypeError", transportCode: "TOKEN_customer-secret" as never,
  });
  assert.match(bad.reasonMessage ?? "", /authorised tool threw/i);
  assert.match(bad.operatorAction ?? "", /toolName/i);
  assert.equal(bad.transportCode, undefined);
  assert.equal(bad.exceptionName, undefined);
  assert.doesNotMatch(JSON.stringify(bad), /customer-secret|ignore all/);
  const actual = new RunnerFailure("UNAVAILABLE", { stage: "tool.execute", reasonCode: "TOOL_EXECUTION_FAILED" }, original);
  assert.equal(actual.diagnostic.exceptionName, "TypeError");
  assert.doesNotMatch(JSON.stringify(actual.diagnostic), /customer-secret/);
});
