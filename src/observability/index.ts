import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Exception,
} from "@opentelemetry/api";

const TRACER_NAME = "@modainteract/moda-interact-shared/observability";
const MAX_MAPPED_EXCEPTION_FIELD_LENGTH = 1_024;

export type SpanExceptionMapper = (error: unknown) => Exception | undefined;

export type ObservedSpanOptions = {
  mapException?: SpanExceptionMapper;
};

export function getActiveTraceId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

export async function withObservedSpan<T>(
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
  options: ObservedSpanOptions = {},
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await work();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      if (options.mapException) {
        try {
          const mappedException = normalizeMappedException(
            options.mapException(error),
          );
          if (mappedException !== undefined) {
            span.recordException(mappedException);
          }
        } catch {
          // Never fall back to the original value after a mapper is supplied.
        }
      } else {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

function normalizeMappedException(
  exception: Exception | undefined,
): Exception | undefined {
  if (typeof exception === "string") {
    return boundedExceptionField(exception);
  }
  if (!exception || typeof exception !== "object") {
    return undefined;
  }

  const code = typeof exception.code === "number"
    ? exception.code
    : boundedExceptionField(exception.code);
  const message = boundedExceptionField(exception.message);
  const name = boundedExceptionField(exception.name);
  const stack = boundedExceptionField(exception.stack);

  if (code === undefined && message === undefined && name === undefined) {
    return undefined;
  }

  return {
    ...(code !== undefined ? { code } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(stack !== undefined ? { stack } : {}),
  } as Exception;
}

function boundedExceptionField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const bounded = value.trim().slice(0, MAX_MAPPED_EXCEPTION_FIELD_LENGTH);
  return bounded || undefined;
}