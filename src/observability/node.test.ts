import assert from "node:assert/strict";
import test from "node:test";
import { ROOT_CONTEXT, SamplingDecision } from "@opentelemetry/api";
import { initNodeObservability, resolveSampler } from "./node.js";

const TRACE_ID = "ffffffffffffffffffffffffffffffff";
const SPAN_ID = "ffffffffffffffff";

function decision(sampler: ReturnType<typeof resolveSampler>): SamplingDecision {
  return sampler.shouldSample(
    ROOT_CONTEXT,
    TRACE_ID,
    "test-span",
    0,
    {},
    [],
  ).decision;
}

function withSamplerEnvironment(
  sampler: string | undefined,
  argument: string | undefined,
  run: () => void,
): void {
  const previousSampler = process.env.OTEL_TRACES_SAMPLER;
  const previousArgument = process.env.OTEL_TRACES_SAMPLER_ARG;

  if (sampler === undefined) {
    delete process.env.OTEL_TRACES_SAMPLER;
  } else {
    process.env.OTEL_TRACES_SAMPLER = sampler;
  }
  if (argument === undefined) {
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
  } else {
    process.env.OTEL_TRACES_SAMPLER_ARG = argument;
  }

  try {
    run();
  } finally {
    if (previousSampler === undefined) {
      delete process.env.OTEL_TRACES_SAMPLER;
    } else {
      process.env.OTEL_TRACES_SAMPLER = previousSampler;
    }
    if (previousArgument === undefined) {
      delete process.env.OTEL_TRACES_SAMPLER_ARG;
    } else {
      process.env.OTEL_TRACES_SAMPLER_ARG = previousArgument;
    }
  }
}

test("supports the architecture-approved sampler matrix", () => {
  const cases: Array<[string, string | undefined, SamplingDecision]> = [
    ["always_on", "0", SamplingDecision.RECORD_AND_SAMPLED],
    ["always_off", "1", SamplingDecision.NOT_RECORD],
    ["traceidratio", "1", SamplingDecision.RECORD_AND_SAMPLED],
    ["traceidratio", "0", SamplingDecision.NOT_RECORD],
    ["parentbased_always_on", "0", SamplingDecision.RECORD_AND_SAMPLED],
    ["parentbased_always_off", "1", SamplingDecision.NOT_RECORD],
    ["parentbased_traceidratio", "1", SamplingDecision.RECORD_AND_SAMPLED],
    ["parentbased_traceidratio", "0", SamplingDecision.NOT_RECORD],
  ];

  for (const [samplerName, argument, expected] of cases) {
    withSamplerEnvironment(samplerName, argument, () => {
      assert.equal(
        decision(resolveSampler(undefined, "production")),
        expected,
        samplerName,
      );
    });
  }
});

test("uses the Moda fallback for invalid sampler configuration", () => {
  withSamplerEnvironment("unsupported", "1", () => {
    assert.match(
      resolveSampler(undefined, "production").toString(),
      /TraceIdRatioBased\{0\.1\}/,
    );
  });

  withSamplerEnvironment("traceidratio", "not-a-ratio", () => {
    assert.match(
      resolveSampler(undefined, "test").toString(),
      /TraceIdRatioBased\{1\}/,
    );
  });
});

test("programmatic ratio overrides environment selection", () => {
  withSamplerEnvironment("always_off", "0", () => {
    assert.equal(
      decision(resolveSampler(1, "production")),
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });
});

test("sampler calls accept a valid span identifier shape", () => {
  withSamplerEnvironment("always_on", undefined, () => {
    const sampler = resolveSampler(undefined, "test");
    assert.equal(TRACE_ID.length, 32);
    assert.equal(SPAN_ID.length, 16);
    assert.equal(decision(sampler), SamplingDecision.RECORD_AND_SAMPLED);
  });
});

test("invalid required configuration degrades without throwing", () => {
  let runtime: ReturnType<typeof initNodeObservability> | undefined;

  assert.doesNotThrow(() => {
    runtime = initNodeObservability({ serviceName: "   " });
  });
  assert.equal(runtime?.enabled, false);
  assert.equal(runtime?.serviceName, "unknown-service");
});