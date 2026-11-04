import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {runCommerceTurn, type RunCommerceTurnInput, type ModelStep, type ModelRequest, runnerVersion} from "./index";
import {exampleManifest, exampleGrant, exampleTurn, exampleTool, exampleFinal} from "../fixtures";
import {commerceDiscountBuiltInDescriptors} from "../built-in-tools";
import {deduplicateTools} from "../selection";
import type {CommerceToolResult} from "../schemas";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const builtin = commerceDiscountBuiltInDescriptors[0];
const answer = {...exampleFinal, answerKind: "ANSWER" as const, replyText: "No verified promotion.", referralReason: null};
const unavailable: CommerceToolResult = {contractVersion: "commerce.v1", status: "OK",
  data: {outcome: "UNAVAILABLE", reasonCode: "TEMPORARY_UNAVAILABLE"}, renderedText: "No current offer information."};
const finish = (value = answer): ModelStep => ({calls: [{name: "finalResponse", arguments: value}], outputTokens: 20});
const call = (): ModelStep => ({calls: [{name: builtin.name, arguments: {}}], outputTokens: 20});
function fixture(steps: ModelStep[] = [call(), finish()]) {
  const manifest = exampleManifest(digest, true);
  manifest.runnerCompatibility = ">=1.1.0 <2.0.0";
  manifest.builtInTools = structuredClone([builtin]);
  manifest.grantedTools = deduplicateTools(manifest.capabilities, manifest.builtInTools);
  const grant = exampleGrant(manifest);
  grant.runnerVersion = runnerVersion;
  let index = 0, executed = 0, authChecks = 0;
  const requests: ModelRequest[] = [];
  const input: RunCommerceTurnInput = {
    turn: structuredClone(exampleTurn), manifest, grant, hostInstructions: [], context: {}, history: [],
    language: {tag: null, source: null}, signal: new AbortController().signal,
    dependencies: {
      digest, now: () => Date.parse("2026-09-20T00:00:10Z"),
      model: {invoke: async request => {requests.push(request); return steps[index++] ?? finish();}},
      tools: [
        {descriptor: exampleTool, isAuthorized: async () => true,
          execute: async () => ({contractVersion: "commerce.v1", status: "OK", data: {}, renderedText: "Read complete."})},
        {descriptor: structuredClone(builtin), isAuthorized: async () => {authChecks++; return true;},
          execute: async () => {executed++; return unavailable;}},
      ],
    },
  };
  return {input, requests, counts: () => ({executed, authChecks})};
}
test("mixed grants advertise pinned built-ins without publishing fake database identities", async () => {
  const f = fixture([{calls: [{name: exampleTool.name, arguments: {handle: "coat"}}, ...call().calls], outputTokens: 40}, finish()]);
  const result = await runCommerceTurn(f.input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(f.requests[0].tools.map(tool => tool.name).sort(), [exampleTool.name, builtin.name, "finalResponse"].sort());
  assert.deepEqual(Object.keys(f.requests[0].tools.find(tool => tool.name === builtin.name)!).sort(), ["name", "description", "inputSchema"].sort());
  assert.equal(f.counts().executed, 1);
  assert.ok(f.counts().authChecks >= 3); // advertisement, pre-execute and post-execute
});
test("optional OK unavailable never manufactures a referral", async () => {
  const result = await runCommerceTurn(fixture().input);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.result.answerKind, "ANSWER");
});
test("outer errors remain terminal through a later successful optional lookup", async () => {
  const f = fixture([call(), call(), finish()]);
  let calls = 0;
  f.input.dependencies.tools[1].execute = async () => ++calls === 1
    ? {contractVersion: "commerce.v1", status: "ERROR", code: "UNAVAILABLE", retryable: false}
    : unavailable;
  const result = await runCommerceTurn(f.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.diagnostic?.reasonCode, "FINAL_REFERRAL_REQUIRED");
});
test("malformed optional output and thrown bugs remain errors", async () => {
  for (const output of [{outcome: "UNAVAILABLE", reasonCode: "DENIED"}, {offers: []}, {outcome: "UNAVAILABLE", reasonCode: "TEMPORARY_UNAVAILABLE", offers: []}]) {
    const f = fixture();
    f.input.dependencies.tools[1].execute = async () => ({contractVersion: "commerce.v1", status: "OK", data: output, renderedText: "Read"});
    const result = await runCommerceTurn(f.input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.diagnostic?.reasonCode, "TOOL_RESULT_INVALID");
  }
  const f = fixture();
  f.input.dependencies.tools[1].execute = async () => {throw new Error("original-tool-bug-marker");};
  assert.equal((await runCommerceTurn(f.input)).ok, false);
});
test("name/version/schema drift, extra registrations, missing descriptor and stale tenant fail closed", async () => {
  const changes: Array<(input: RunCommerceTurnInput) => void> = [
    input => {input.dependencies.tools[1].descriptor.name = "ungranted_tool";},
    input => {input.dependencies.tools[1].descriptor.definitionVersion = "1.0.1";},
    input => {input.dependencies.tools[1].descriptor.inputSchema.properties = {};},
    input => {input.manifest.builtInTools = [];},
    input => {input.dependencies.tools.pop();},
    input => {input.dependencies.tools.push({...input.dependencies.tools[0], descriptor: {...exampleTool, name: "extra_tool"}});},
    input => {input.turn.shopId = "wrong-shop";},
    input => {input.turn.conversationId = "wrong-conversation";},
    input => {input.turn.inboundVersion = 0;},
    input => {input.dependencies.tools = Array(33).fill(input.dependencies.tools[0]);},
  ];
  for (const change of changes) {
    const f = fixture(); change(f.input);
    const result = await runCommerceTurn(f.input);
    assert.equal(result.ok, false, change.toString());
    assert.equal(f.counts().executed, 0);
  }
});
test("revocation after advertisement prevents execution and is retained in referral state", async () => {
  const f = fixture([call(), {calls: [{name: "finalResponse", arguments: {...exampleFinal, referralReason: "TOOL_REVOKED"}}], outputTokens: 20}]);
  let checks = 0;
  f.input.dependencies.tools[1].isAuthorized = async () => ++checks === 1;
  const result = await runCommerceTurn(f.input);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.counts().executed, 0);
});
test("authorization is rechecked after an awaited tool result", async () => {
  const f = fixture();
  let current = true;
  f.input.dependencies.tools[1].isAuthorized = async () => current;
  f.input.dependencies.tools[1].execute = async () => {current = false; return unavailable;};
  const result = await runCommerceTurn(f.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.diagnostic?.reasonCode, "FINAL_REFERRAL_REQUIRED");
});
test("stale result, cancellation, deadline and remote-call ceilings still bound built-ins", async () => {
  const stale = fixture();
  stale.input.dependencies.tools[1].execute = async () => ({contractVersion: "commerce.v1", status: "ERROR", code: "STALE_TURN", retryable: false});
  const staleResult = await runCommerceTurn(stale.input);
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, "STALE_TURN");
  const cancelled = fixture();
  const controller = new AbortController(); controller.abort(); cancelled.input.signal = controller.signal;
  const result = await runCommerceTurn(cancelled.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CANCELLED");
  const capped = fixture([call(), call(), finish()]); capped.input.budgets = {remoteCalls: 1};
  const capResult = await runCommerceTurn(capped.input);
  assert.equal(capResult.ok, false);
  if (!capResult.ok) assert.equal(capResult.error.code, "BUDGET_EXHAUSTED");
  const deadline = fixture(); deadline.input.budgets = {deadlineMs: 20};
  deadline.input.dependencies.tools[1].execute = async (_args, signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelled owned tool")), {once: true});
  });
  const deadlineResult = await runCommerceTurn(deadline.input);
  assert.equal(deadlineResult.ok, false);
  if (!deadlineResult.ok) assert.equal(deadlineResult.error.code, "DEADLINE");
});


test("descriptor drift across model/authorization awaits cannot change registered inputs", async () => {
  for (const stage of ["model", "authorization"]) {
    const f = fixture();
    if (stage === "model") {
      f.input.dependencies.model.invoke = async () => {
        f.input.dependencies.tools[1].descriptor.inputSchema.properties = {};
        return call();
      };
    } else {
      let checks = 0;
      f.input.dependencies.tools[1].isAuthorized = async () => {
        if (++checks === 2) f.input.dependencies.tools[1].descriptor.inputSchema.properties = {};
        return true;
      };
    }
    const result = await runCommerceTurn(f.input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INCOMPATIBLE_VERSION");
    assert.equal(f.counts().executed, 0);
  }
});
test("an actual stale-turn result remains terminal even if authorization is concurrently revoked", async () => {
  const f = fixture();
  let current = true;
  f.input.dependencies.tools[1].isAuthorized = async () => current;
  f.input.dependencies.tools[1].execute = async () => {
    current = false;
    return {contractVersion: "commerce.v1", status: "ERROR", code: "STALE_TURN", retryable: false};
  };
  const result = await runCommerceTurn(f.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "STALE_TURN");
});
