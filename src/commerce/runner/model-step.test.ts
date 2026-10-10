import assert from "node:assert/strict";
import test from "node:test";
import { validateModelStep } from "./model-step.js";
import { mapRunnerFailure } from "./failure.js";

const valid = () => ({ calls: [{ name: "finalResponse", arguments: {} }], outputTokens: 1 });

const invalidCases: ReadonlyArray<{
  name: string;
  step: unknown;
  reasonCode: string;
  callIndex?: number;
}> = [
  { name: "null model step", step: null, reasonCode: "MODEL_STEP_NOT_OBJECT" },
  { name: "missing calls", step: { outputTokens: 1 }, reasonCode: "MODEL_STEP_CALLS_MISSING" },
  { name: "calls is not an array", step: { ...valid(), calls: {} }, reasonCode: "MODEL_STEP_CALLS_NOT_ARRAY" },
  { name: "missing outputTokens", step: { calls: [] }, reasonCode: "MODEL_OUTPUT_TOKENS_MISSING" },
  { name: "fractional outputTokens", step: { ...valid(), outputTokens: 1.5 }, reasonCode: "MODEL_OUTPUT_TOKENS_NOT_SAFE_INTEGER" },
  { name: "negative outputTokens", step: { ...valid(), outputTokens: -1 }, reasonCode: "MODEL_OUTPUT_TOKENS_NEGATIVE" },
  { name: "over-budget outputTokens", step: { ...valid(), outputTokens: 11 }, reasonCode: "MODEL_OUTPUT_TOKENS_OVER_BUDGET" },
  { name: "too many calls", step: { ...valid(), calls: Array.from({ length: 33 }, () => valid().calls[0]) }, reasonCode: "MODEL_TOOL_CALL_LIMIT_EXCEEDED" },
  { name: "null tool call", step: { ...valid(), calls: [null] }, reasonCode: "MODEL_TOOL_CALL_NULL", callIndex: 0 },
  { name: "nonobject tool call", step: { ...valid(), calls: [17] }, reasonCode: "MODEL_TOOL_CALL_NOT_OBJECT", callIndex: 0 },
  { name: "missing tool-call name", step: { ...valid(), calls: [{ arguments: {} }] }, reasonCode: "MODEL_TOOL_CALL_NAME_MISSING", callIndex: 0 },
  { name: "nonstring tool-call name", step: { ...valid(), calls: [{ name: 42, arguments: {} }] }, reasonCode: "MODEL_TOOL_CALL_NAME_NOT_STRING", callIndex: 0 },
  { name: "empty tool-call name", step: { ...valid(), calls: [{ name: "", arguments: {} }] }, reasonCode: "MODEL_TOOL_CALL_NAME_EMPTY", callIndex: 0 },
  { name: "oversized tool-call name", step: { ...valid(), calls: [{ name: "x".repeat(129), arguments: {} }] }, reasonCode: "MODEL_TOOL_CALL_NAME_TOO_LONG", callIndex: 0 },
  { name: "missing tool-call arguments", step: { ...valid(), calls: [{ name: "finalResponse" }] }, reasonCode: "MODEL_TOOL_CALL_ARGUMENTS_MISSING", callIndex: 0 },
  { name: "null tool-call arguments", step: { ...valid(), calls: [{ name: "finalResponse", arguments: null }] }, reasonCode: "MODEL_TOOL_CALL_ARGUMENTS_NULL", callIndex: 0 },
  { name: "array tool-call arguments", step: { ...valid(), calls: [{ name: "finalResponse", arguments: [] }] }, reasonCode: "MODEL_TOOL_CALL_ARGUMENTS_NOT_OBJECT", callIndex: 0 },
  { name: "oversized serialized model step", step: { ...valid(), calls: [{ name: "finalResponse", arguments: { text: "x".repeat(262144) } }] }, reasonCode: "MODEL_STEP_TOO_LARGE" },
];

for (const { name, step, reasonCode, callIndex } of invalidCases) {
  test(`model-step diagnostics: ${name}`, () => {
    let thrown: unknown;
    try { validateModelStep(step, 10); } catch (error) { thrown = error; }
    const result = mapRunnerFailure(thrown);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "INVALID_FINAL");
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.diagnostic?.stage, "model.validate");
    assert.equal(result.error.diagnostic?.reasonCode, reasonCode);
    assert.equal(result.error.diagnostic?.callIndex, callIndex);
    assert.ok(result.error.diagnostic?.reasonMessage);
    assert.ok(result.error.diagnostic?.operatorAction);
  });
}

test("model-step diagnostics identify the specific rejected call without leaking contents", () => {
  const sensitive = "PRIVATE_CUSTOMER_TEXT";
  const step = { ...valid(), calls: [valid().calls[0], null, { name: sensitive, arguments: {} }] };
  let thrown: unknown;
  try { validateModelStep(step, 10); } catch (error) { thrown = error; }
  const result = mapRunnerFailure(thrown);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.diagnostic?.reasonCode, "MODEL_TOOL_CALL_NULL");
  assert.equal(result.error.diagnostic?.callIndex, 1);
  assert.match(result.error.diagnostic?.reasonMessage ?? "", /null tool-call entry at index 1/i);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CUSTOMER_TEXT/);
});

test("model-step diagnostics distinguish canonical JSON failure from payload size", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  let thrown: unknown;
  try { validateModelStep({ ...valid(), calls: [{ name: "finalResponse", arguments: circular }] }, 10); }
  catch (error) { thrown = error; }
  const result = mapRunnerFailure(thrown);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.diagnostic?.reasonCode, "MODEL_STEP_NOT_SERIALIZABLE");
});

test("model-step validator preserves a successful step", () => {
  const step = valid();
  assert.equal(validateModelStep(step, 10), step);
});
