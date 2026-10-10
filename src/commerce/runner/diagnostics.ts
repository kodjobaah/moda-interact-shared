import type { ZodError } from "zod";
import { describeRunnerDiagnostic } from "./diagnostic-messages.js";

/** Finite, non-customer-facing failure taxonomy for Commerce hosts and logs. */
export const RUNNER_DIAGNOSTIC_STAGES = [
  "preflight.validate", "preflight.contract", "runtime.cancellation", "runtime.deadline",
  "runtime.operation", "tools.resolve", "model.invoke", "model.validate", "model.route",
  "tool.authorize", "tool.validate", "tool.execute", "tool.result", "evidence.validate",
  "final.validate", "graph.execute",
] as const;
export type RunnerDiagnosticStage = typeof RUNNER_DIAGNOSTIC_STAGES[number];

export const RUNNER_DIAGNOSTIC_REASONS = [
  "CANCELLED_BY_CALLER", "TURN_DEADLINE_EXCEEDED", "OPERATION_TIMEOUT",
  "UPSTREAM_OPERATION_FAILED", "UNEXPECTED_EXCEPTION",
  "INPUT_TOO_LARGE", "TURN_INVALID", "GRANT_INVALID", "MANIFEST_INVALID",
  "GRANT_MISMATCH", "RUNNER_VERSION_INCOMPATIBLE", "RESPONSE_CONTRACT_INVALID",
  "LANGUAGE_INVALID", "BUDGET_INVALID", "CONTEXT_INVALID", "TOOL_REGISTRATION_INVALID",
  "MODEL_STEP_BUDGET_EXHAUSTED", "MODEL_INVOCATION_FAILED",
  "MODEL_STEP_NOT_OBJECT", "MODEL_STEP_CALLS_MISSING", "MODEL_STEP_CALLS_NOT_ARRAY",
  "MODEL_OUTPUT_TOKENS_MISSING", "MODEL_OUTPUT_TOKENS_NOT_SAFE_INTEGER",
  "MODEL_OUTPUT_TOKENS_NEGATIVE", "MODEL_OUTPUT_TOKENS_OVER_BUDGET",
  "MODEL_TOOL_CALL_LIMIT_EXCEEDED", "MODEL_TOOL_CALL_NULL", "MODEL_TOOL_CALL_NOT_OBJECT",
  "MODEL_TOOL_CALL_NAME_MISSING", "MODEL_TOOL_CALL_NAME_NOT_STRING", "MODEL_TOOL_CALL_NAME_EMPTY",
  "MODEL_TOOL_CALL_NAME_TOO_LONG", "MODEL_TOOL_CALL_ARGUMENTS_MISSING",
  "MODEL_TOOL_CALL_ARGUMENTS_NULL", "MODEL_TOOL_CALL_ARGUMENTS_NOT_OBJECT",
  "MODEL_STEP_TOO_LARGE", "MODEL_STEP_NOT_SERIALIZABLE", "MODEL_STEP_VALIDATION_FAILED",
  "MODEL_CALL_ROUTE_INVALID", "MODEL_RESULT_MISSING",
  "REQUEST_INVALID", "MODEL_REQUEST_HISTORY_INVALID", "MODEL_REQUEST_TOOL_RESULT_INVALID",
  "MODEL_CONFIGURATION_INVALID", "MODEL_CREDENTIAL_INVALID", "MODEL_ADAPTER_INITIALIZATION_FAILED",
  "MODEL_REQUEST_CANCELLED", "TOOL_BIND_FAILED", "PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED",
  "PROVIDER_HTTP_ERROR", "PROVIDER_REQUEST_FAILED", "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_RESPONSE_USAGE_INVALID", "PROVIDER_RESPONSE_TOOL_CALL_INVALID",
  "TOOL_DESCRIPTOR_MISMATCH", "TOOL_AUTHORIZATION_FAILED", "TOOL_INPUT_INVALID",
  "TOOL_CALL_BUDGET_EXHAUSTED", "TOOL_EXECUTION_FAILED", "TOOL_RESULT_TOO_LARGE",
  "TOOL_RESULT_INVALID", "TOOL_RESULT_MISSING", "TOOL_STALE_TURN",
  "EVIDENCE_INVALID", "FINAL_SCHEMA_INVALID", "FINAL_LANGUAGE_MISMATCH",
  "FINAL_REFERRAL_REQUIRED", "FINAL_EVIDENCE_INVALID", "FINAL_EVIDENCE_EXPIRED",
  "EVIDENCE_RESERVATION_EXCEEDED",
] as const;
export type RunnerDiagnosticReason = typeof RUNNER_DIAGNOSTIC_REASONS[number];

/** Recognised transport failures, never arbitrary OS/provider error codes. */
export const RUNNER_TRANSPORT_CODES = [
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
  "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
] as const;
export type RunnerTransportCode = typeof RUNNER_TRANSPORT_CODES[number];

const recognizedExceptionNames = new Set([
  "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError",
  "EvalError", "AggregateError", "AbortError", "TimeoutError",
]);
const recognizedTransportCodes = new Set<string>(RUNNER_TRANSPORT_CODES);


/** All optional fields are allowlisted; never include free-form provider or exception text. */
export type RunnerDiagnostic = Readonly<{
  stage: RunnerDiagnosticStage;
  reasonCode: RunnerDiagnosticReason;
  /** Fixed, safe operator explanation; computed from the validated code and detail. */
  reasonMessage?: string;
  /** Fixed, safe next step for the operator; never provider-supplied. */
  operatorAction?: string;
  /** Transport/exception details are from a fixed allowlist, not error.message. */
  transportCode?: RunnerTransportCode;
  exceptionName?: string;
  statusCode?: number;
  providerCode?: number;
  providerStage?: "request" | "binding" | "provider" | "response";
  modelStep?: number;
  /** Zero-based index for a rejected tool call. Never includes user content. */
  callIndex?: number;
  remoteCallNumber?: number;
  attempt?: number;
  toolName?: string;
  issueCount?: number;
  issueCodes?: readonly string[];
  issuePaths?: readonly string[];
}>;

const stages = new Set<string>(RUNNER_DIAGNOSTIC_STAGES);
const reasons = new Set<string>(RUNNER_DIAGNOSTIC_REASONS);
const issueCodes = new Set([
  "invalid_type", "too_big", "too_small", "invalid_format", "invalid_value",
  "unrecognized_keys", "invalid_union", "invalid_key", "invalid_element", "custom",
]);
const knownPathParts = new Set([
  "turn", "grant", "manifest", "shopId", "conversationId", "checkoutRecoveryId",
  "inboundVersion", "initialInboundVersion", "id", "releaseId", "responseContract",
  "responseContractHash", "runnerCompatibility", "grantedTools", "capabilities",
  "featureBehaviours", "language", "tag", "source", "budget", "modelSteps",
  "remoteCalls", "deadlineMs", "outputTokens", "history", "context", "instructions",
  "answerKind", "referralReason", "replyText", "detectedLanguageTag", "evidenceIds",
  "details", "contractVersion", "status", "data", "renderedText", "calls",
  "name", "arguments", "toolName", "toolId", "toolRevisionId", "definitionVersion",
]);

function boundedInt(value: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : undefined;
}

/** Also sanitize internally constructed diagnostics before exposing them to hosts or logs. */
export function safeRunnerDiagnostic(diagnostic: RunnerDiagnostic): RunnerDiagnostic {
  const fields: RunnerDiagnostic = {
    stage: stages.has(diagnostic.stage) ? diagnostic.stage : "graph.execute",
    reasonCode: reasons.has(diagnostic.reasonCode) ? diagnostic.reasonCode : "UNEXPECTED_EXCEPTION",
    ...(recognizedTransportCodes.has(diagnostic.transportCode ?? "") ? { transportCode: diagnostic.transportCode } : {}),
    ...(recognizedExceptionNames.has(diagnostic.exceptionName ?? "") ? { exceptionName: diagnostic.exceptionName } : {}),
    ...(boundedInt(diagnostic.statusCode, 100, 599) === undefined ? {} : { statusCode: diagnostic.statusCode }),
    ...(boundedInt(diagnostic.providerCode, 0, 999999) === undefined ? {} : { providerCode: diagnostic.providerCode }),
    ...(["request", "binding", "provider", "response"].includes(diagnostic.providerStage ?? "")
      ? { providerStage: diagnostic.providerStage } : {}),
    ...(boundedInt(diagnostic.modelStep, 1, 12) === undefined ? {} : { modelStep: diagnostic.modelStep }),
    ...(boundedInt(diagnostic.callIndex, 0, 31) === undefined ? {} : { callIndex: diagnostic.callIndex }),
    ...(boundedInt(diagnostic.remoteCallNumber, 1, 10) === undefined ? {} : { remoteCallNumber: diagnostic.remoteCallNumber }),
    ...(boundedInt(diagnostic.attempt, 1, 2) === undefined ? {} : { attempt: diagnostic.attempt }),
    ...(typeof diagnostic.toolName === "string" && /^[a-z][a-z0-9_]{0,127}$/.test(diagnostic.toolName)
      ? { toolName: diagnostic.toolName } : {}),
    ...(boundedInt(diagnostic.issueCount, 0, 10000) === undefined ? {} : { issueCount: diagnostic.issueCount }),
    ...(Array.isArray(diagnostic.issueCodes) ? {
      issueCodes: [...new Set(diagnostic.issueCodes.filter((code) => issueCodes.has(code)))].slice(0, 5),
    } : {}),
    ...(Array.isArray(diagnostic.issuePaths) ? {
      issuePaths: [...new Set(diagnostic.issuePaths.filter((path) =>
        typeof path === "string" && path.length <= 80 && path.split(".").every((part) => knownPathParts.has(part)),
      ))].slice(0, 5),
    } : {}),
  };
  const explanation = describeRunnerDiagnostic(fields);
  return Object.freeze({ ...fields, reasonMessage: explanation.message, operatorAction: explanation.action });
}

/** Extract only known error names and network codes from a bounded cause chain. */
export function safeRunnerCauseMetadata(error: unknown): Pick<RunnerDiagnostic, "transportCode" | "exceptionName"> {
  const visited = new Set<unknown>();
  let current = error;
  let transportCode: RunnerTransportCode | undefined;
  let exceptionName: string | undefined;
  for (let depth = 0; depth < 6 && current instanceof Error && !visited.has(current); depth += 1) {
    visited.add(current);
    try {
      const code = (current as Error & { code?: unknown }).code;
      if (typeof code === "string" && recognizedTransportCodes.has(code))
        transportCode = code as RunnerTransportCode;
      if (!exceptionName && recognizedExceptionNames.has(current.name)) exceptionName = current.name;
      current = current.cause;
    } catch {
      break; // A hostile error object/getter must not interrupt the original failure path.
    }
  }
  return {
    ...(transportCode ? { transportCode } : {}),
    ...(exceptionName ? { exceptionName } : {}),
  };
}

/** Only static schema keys and Zod's finite issue-code vocabulary may leave this boundary. */
export function schemaIssueMetadata(error: ZodError): Pick<RunnerDiagnostic, "issueCount" | "issueCodes" | "issuePaths"> {
  const paths = error.issues.map((issue) =>
    issue.path.filter((part): part is string => typeof part === "string")
      .filter((part) => knownPathParts.has(part)).slice(0, 3).join("."),
  ).filter(Boolean);
  return {
    issueCount: Math.min(error.issues.length, 10000),
    issueCodes: [...new Set(error.issues.map((issue) => issue.code).filter((code) => issueCodes.has(code)))].slice(0, 5),
    issuePaths: [...new Set(paths)].slice(0, 5),
  };
}
