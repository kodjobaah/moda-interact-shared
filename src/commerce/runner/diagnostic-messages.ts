import type { RunnerDiagnosticReason, RunnerTransportCode } from "./diagnostics.js";

type Explanation = Readonly<{ message: string; action: string }>;

/** Fixed operator-facing explanations. No provider-supplied or customer-supplied text is interpolated. */
const explanations = {
  CANCELLED_BY_CALLER: ["The calling service cancelled this conversation turn.", "Inspect caller cancellation and superseded-message handling."],
  TURN_DEADLINE_EXCEEDED: ["The conversation turn exceeded its overall deadline.", "Inspect elapsed time across the model and tool calls."],
  OPERATION_TIMEOUT: ["One model or tool operation exceeded its per-operation time limit.", "Inspect the operation stage, provider latency and timeout configuration."],
  UPSTREAM_OPERATION_FAILED: ["A model or tool operation threw an exception before returning a usable result.", "Inspect the stage, exceptionName and transportCode; check upstream service health."],
  UNEXPECTED_EXCEPTION: ["The runner encountered an unexpected exception.", "Inspect the failing stage and exceptionName; investigate the owning service."],
  INPUT_TOO_LARGE: ["The manifest or conversation grant exceeded the allowed payload size.", "Reduce the manifest or grant size and check the producer's limits."],
  TURN_INVALID: ["The supplied conversation-turn identity failed schema validation.", "Inspect the reported schema issue paths and the turn producer."],
  GRANT_INVALID: ["The supplied conversation grant failed schema validation.", "Inspect the reported schema issue paths and grant issuer."],
  MANIFEST_INVALID: ["The supplied capability manifest failed schema validation.", "Verify manifest version and schema fields against the published contract."],
  GRANT_MISMATCH: ["The turn identity, grant and manifest do not belong to the same authorised conversation.", "Check shop, conversation, grant and inbound-version correlation; do not bypass authorization."],
  RUNNER_VERSION_INCOMPATIBLE: ["The release manifest requires a different runner version.", "Align the deployed Shared runner version with the release's compatibility range."],
  RESPONSE_CONTRACT_INVALID: ["The trusted final-response contract failed integrity or compatibility verification.", "Recheck the published release and contract digest."],
  LANGUAGE_INVALID: ["The supplied conversation language or language-source fields are invalid.", "Check the host language configuration and supported locale values."],
  BUDGET_INVALID: ["A configured model, remote-call, deadline or token budget is invalid.", "Check budget ranges supplied by the caller."],
  CONTEXT_INVALID: ["The trusted instructions, history or context failed size or shape constraints.", "Inspect context construction and trim oversized history or instructions."],
  TOOL_REGISTRATION_INVALID: ["The host registered duplicate or otherwise invalid tools.", "Check the tool registry supplied to the runner."],
  MODEL_STEP_BUDGET_EXHAUSTED: ["The model used every allowed reasoning step without reaching a valid final answer.", "Inspect model routing and tool-call loops; reassess the configured step budget."],
  MODEL_INVOCATION_FAILED: ["The model invocation failed without a provider-specific diagnostic.", "Inspect the model host and preserve a typed provider failure at its boundary."],
  MODEL_STEP_NOT_OBJECT: ["The model step was not a non-null object.", "Check the model adapter's returned step type."],
  MODEL_STEP_CALLS_MISSING: ["The model step did not contain a calls field.", "Ensure the model adapter returns a calls array, even when empty."],
  MODEL_STEP_CALLS_NOT_ARRAY: ["The model step's calls field was not an array.", "Ensure the model adapter maps provider tool calls to an array."],
  MODEL_OUTPUT_TOKENS_MISSING: ["The model step did not contain an outputTokens field.", "Ensure the adapter includes the provider's output-token usage count."],
  MODEL_OUTPUT_TOKENS_NOT_SAFE_INTEGER: ["The model step's outputTokens was not a safe integer.", "Ensure the adapter returns a finite, whole-number output token count."],
  MODEL_OUTPUT_TOKENS_NEGATIVE: ["The model step's outputTokens was negative.", "Correct the model adapter's token-usage mapping; token counts cannot be negative."],
  MODEL_OUTPUT_TOKENS_OVER_BUDGET: ["The model step's outputTokens exceeded the configured output-token budget.", "Inspect the model's maxOutputTokens enforcement and returned usage count."],
  MODEL_TOOL_CALL_LIMIT_EXCEEDED: ["The model step contained more than 32 tool calls.", "Limit provider tool-call output to the runner's maximum of 32 calls."],
  MODEL_TOOL_CALL_NULL: ["The model returned a null tool-call entry.", "Check the model adapter's tool-call conversion; each entry must have a name and arguments object."],
  MODEL_TOOL_CALL_NOT_OBJECT: ["The model returned a tool-call entry that was not an object.", "Check the model adapter's tool-call conversion; arrays and primitive entries are invalid."],
  MODEL_TOOL_CALL_NAME_MISSING: ["The model returned a tool call without a name field.", "Include a non-empty name string in every model tool call."],
  MODEL_TOOL_CALL_NAME_NOT_STRING: ["The model returned a tool call whose name was not a string.", "Ensure the tool-call name is a string in the model adapter."],
  MODEL_TOOL_CALL_NAME_EMPTY: ["The model returned a tool call with an empty name.", "Check provider tool naming and model adapter normalization."],
  MODEL_TOOL_CALL_NAME_TOO_LONG: ["The model returned a tool-call name longer than 128 characters.", "Limit each tool-call name to 128 characters in the model adapter."],
  MODEL_TOOL_CALL_ARGUMENTS_MISSING: ["The model returned a tool call without an arguments field.", "Include an arguments object for every model tool call."],
  MODEL_TOOL_CALL_ARGUMENTS_NULL: ["The model returned a tool call with null arguments.", "Return an object, including an empty object when appropriate, instead of null arguments."],
  MODEL_TOOL_CALL_ARGUMENTS_NOT_OBJECT: ["The model returned tool-call arguments that were not an object.", "Convert provider tool-call arguments to a non-array object in the model adapter."],
  MODEL_STEP_TOO_LARGE: ["The model step exceeded the 262144-byte serialized payload limit.", "Reduce tool-call argument payload size before returning the model step."],
  MODEL_STEP_NOT_SERIALIZABLE: ["The model step could not be encoded as canonical JSON.", "Inspect model-step data for cycles, invalid Unicode or unsupported JSON values."],
  MODEL_STEP_VALIDATION_FAILED: ["The runner threw an exception while reading or checking the model step.", "Inspect the safe exception metadata and model-step adapter implementation."],
  MODEL_CALL_ROUTE_INVALID: ["The model produced an invalid mixture of final-response and tool calls.", "Check tool-choice and finalResponse routing requirements."],
  MODEL_RESULT_MISSING: ["The runner graph finished without producing a final response.", "Inspect graph termination and the preceding model/tool steps."],
  REQUEST_INVALID: ["The model adapter received an invalid invocation request.", "Inspect the model request construction and trusted payload validation."],
  MODEL_REQUEST_HISTORY_INVALID: ["A history entry sent to the model was malformed or exceeded its text limit.", "Inspect the history formatter and permitted role/text shape."],
  MODEL_REQUEST_TOOL_RESULT_INVALID: ["A tool-result message sent to the model failed the expected contract.", "Inspect the tool-result formatter and CommerceToolResult schema."],
  MODEL_CONFIGURATION_INVALID: ["The configured model provider, model ID, options or schema version is invalid.", "Correct model selection and published configuration before invoking the model."],
  MODEL_CREDENTIAL_INVALID: ["The model adapter received an empty or invalid credential value.", "Check secret resolution, credential availability and injection into the model host."],
  MODEL_ADAPTER_INITIALIZATION_FAILED: ["The model client could not be constructed from its validated configuration.", "Inspect model SDK initialization and dependency compatibility."],
  MODEL_REQUEST_CANCELLED: ["The model request was cancelled before invocation.", "Inspect caller cancellation; do not interpret this as provider downtime."],
  TOOL_BIND_FAILED: ["The model client rejected the supplied tool definitions during binding.", "Check provider tool-calling support and function schemas."],
  PROVIDER_AUTH_FAILED: ["The model provider rejected authentication or access to the requested resource.", "Check the provider credential, permissions and selected model."],
  PROVIDER_RATE_LIMITED: ["The model provider returned HTTP 429: requests are being rate-limited or the quota is exhausted.", "Check provider usage, billing/quota and any Retry-After guidance; use bounded backoff."],
  PROVIDER_HTTP_ERROR: ["The model provider returned an unsuccessful HTTP response.", "Inspect statusCode and check provider availability, model access and request compatibility."],
  PROVIDER_REQUEST_FAILED: ["The model provider request failed before a usable HTTP response was received.", "Inspect transportCode and exceptionName; check DNS, connectivity, TLS and provider availability."],
  PROVIDER_RESPONSE_INVALID: ["The model provider returned a response that the adapter cannot interpret.", "Check the provider SDK response shape and model adapter compatibility."],
  PROVIDER_RESPONSE_USAGE_INVALID: ["The model response is missing a valid output-token usage count.", "Inspect provider usage_metadata.output_tokens and SDK response mapping."],
  PROVIDER_RESPONSE_TOOL_CALL_INVALID: ["The model response contains a malformed tool call name or arguments object.", "Inspect provider tool-call formatting and SDK response mapping."],
  TOOL_DESCRIPTOR_MISMATCH: ["The requested tool does not match an authorised published tool descriptor.", "Check published tool revisions and descriptor hashes."],
  TOOL_AUTHORIZATION_FAILED: ["The host failed while checking whether a requested tool remains authorised.", "Inspect authorization-service availability and the requested tool."],
  TOOL_INPUT_INVALID: ["The model supplied tool arguments that do not satisfy the tool input schema.", "Inspect issuePaths and the model's tool schema; do not invoke the tool."],
  TOOL_CALL_BUDGET_EXHAUSTED: ["The turn exhausted its remote-call allowance before the next tool request.", "Inspect repeated tool calls, retry attempts and budget settings."],
  TOOL_EXECUTION_FAILED: ["An authorised tool threw an exception during execution.", "Inspect the toolName, attempt, transportCode and owning tool service."],
  TOOL_RESULT_TOO_LARGE: ["A tool returned more data than the runner permits.", "Reduce or paginate tool output before returning it to the runner."],
  TOOL_RESULT_INVALID: ["A tool returned a result that failed serialization or schema validation.", "Inspect issuePaths and the tool adapter's CommerceToolResult output."],
  TOOL_RESULT_MISSING: ["The tool execution loop ended without receiving a result.", "Inspect tool execution lifecycle and retry completion."],
  TOOL_STALE_TURN: ["The tool reported that the conversation turn is no longer current.", "Inspect conversation versioning and abandon this obsolete turn."],
  EVIDENCE_INVALID: ["Tool evidence failed its integrity, grant or freshness checks.", "Inspect tool evidence generation and turn/grant correlation."],
  FINAL_SCHEMA_INVALID: ["The model's finalResponse failed runtime schema validation.", "Inspect issueCodes and issuePaths; correct response formatting or tool instructions."],
  FINAL_LANGUAGE_MISMATCH: ["The final answer included language detection despite an explicit customer language.", "Check model instructions governing language metadata."],
  FINAL_REFERRAL_REQUIRED: ["The model did not produce the mandatory store referral after a denied or failed tool.", "Check final-response referral rules and the recorded tool outcome."],
  FINAL_EVIDENCE_INVALID: ["The final answer cited absent, unqualified or incorrectly scoped evidence.", "Inspect evidence identity, qualification and answer construction."],
  FINAL_EVIDENCE_EXPIRED: ["The final answer cited evidence that expired during the turn.", "Refresh evidence and reconsider the turn's remaining deadline."],
  EVIDENCE_RESERVATION_EXCEEDED: ["The final answer cited more evidence than the remaining remote-call reservation allows.", "Inspect evidence references and the remote-call budget reservation contract."],
} as const satisfies Record<RunnerDiagnosticReason, readonly [string, string]>;

const transports = {
  ENOTFOUND: ["The provider hostname could not be resolved by DNS.", "Check the configured hostname and DNS resolver."],
  EAI_AGAIN: ["The provider DNS lookup temporarily failed.", "Check DNS availability and retry after a short delay."],
  ECONNREFUSED: ["The provider connection was actively refused.", "Check the host, port and service listener."],
  ECONNRESET: ["The provider connection was reset before the request finished.", "Check upstream restarts, proxies and connection stability."],
  ETIMEDOUT: ["The network connection to the provider timed out.", "Check network reachability and upstream latency."],
  ENETUNREACH: ["The network route to the provider is unreachable.", "Check egress routes, firewall and network configuration."],
  EHOSTUNREACH: ["The provider host is unreachable.", "Check provider host, routing and firewall rules."],
  EPIPE: ["The network connection closed while data was being written.", "Check upstream connection stability and proxy timeouts."],
  UND_ERR_CONNECT_TIMEOUT: ["The HTTP client timed out establishing a provider connection.", "Check egress connectivity and provider latency."],
  UND_ERR_HEADERS_TIMEOUT: ["The HTTP client timed out waiting for provider response headers.", "Check provider availability and response latency."],
  UND_ERR_SOCKET: ["The HTTP client reported a socket failure.", "Check network and upstream connection stability."],
  CERT_HAS_EXPIRED: ["The remote TLS certificate has expired.", "Check the certificate chain and provider endpoint."],
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: ["TLS certificate chain verification failed.", "Check trusted roots and certificate chain; do not disable TLS validation."],
  DEPTH_ZERO_SELF_SIGNED_CERT: ["TLS rejected an untrusted self-signed certificate.", "Check trusted roots and proxy certificates; do not disable TLS validation."],
  ERR_TLS_CERT_ALTNAME_INVALID: ["The provider TLS certificate does not match its hostname.", "Check endpoint hostname and certificate SANs."],
} as const satisfies Record<RunnerTransportCode, readonly [string, string]>;

/** HTTP descriptions are based on status alone and make no claims about hidden provider response bodies. */
const httpDetails: Readonly<Record<number, Explanation>> = {
  400: { message: "The provider rejected the request as invalid (HTTP 400).", action: "Check request parameters and provider model capabilities." },
  402: { message: "The provider returned HTTP 402 (payment or credits required).", action: "Check provider billing, available credits and account limits." },
  404: { message: "The provider returned HTTP 404 (endpoint or model not found).", action: "Check provider model ID, permissions and API route." },
  413: { message: "The provider rejected an oversized request (HTTP 413).", action: "Reduce request size and review model context limits." },
  422: { message: "The provider could not process the request parameters (HTTP 422).", action: "Check model input and tool schema compatibility." },
  500: { message: "The provider returned an internal server error (HTTP 500).", action: "Check provider status and use bounded retries." },
  502: { message: "The provider gateway reported an upstream error (HTTP 502).", action: "Check provider status, gateway health and bounded retries." },
  503: { message: "The provider is temporarily unavailable (HTTP 503).", action: "Check provider availability and backoff guidance." },
  504: { message: "The provider gateway timed out (HTTP 504).", action: "Check upstream latency and provider availability." },
};

export function describeRunnerDiagnostic(input: {
  reasonCode: RunnerDiagnosticReason;
  statusCode?: number;
  transportCode?: RunnerTransportCode;
  callIndex?: number;
}): Explanation {
  if (
    input.transportCode &&
    ["PROVIDER_REQUEST_FAILED", "UPSTREAM_OPERATION_FAILED", "MODEL_INVOCATION_FAILED", "TOOL_EXECUTION_FAILED", "TOOL_AUTHORIZATION_FAILED"].includes(input.reasonCode)
  ) {
    const explanation = transports[input.transportCode];
    return { message: `${explanation[0]} (${input.transportCode})`, action: explanation[1] };
  }
  if (input.reasonCode === "PROVIDER_HTTP_ERROR" && input.statusCode !== undefined && httpDetails[input.statusCode])
    return httpDetails[input.statusCode];
  const explanation = explanations[input.reasonCode];
  if (input.reasonCode === "MODEL_TOOL_CALL_NULL" && input.callIndex !== undefined)
    return {
      message: `The model returned a null tool-call entry at index ${input.callIndex}. Each tool call must contain a non-empty name and an arguments object.`,
      action: explanation[1],
    };
  if (input.reasonCode.startsWith("MODEL_TOOL_CALL_") && input.callIndex !== undefined)
    return { message: `${explanation[0].replace(/\.$/, "")} (index ${input.callIndex}).`, action: explanation[1] };
  return { message: explanation[0], action: explanation[1] };
}
