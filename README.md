# @modainteract/moda-interact-shared

Shared TypeScript contracts and reusable platform primitives used by multiple
Moda Interact services.

This package is a **library**, not a deployable service. It does not own
business transports, persistence, background workers, provider SDK integration,
or application business workflows.

## Install

```bash
npm install @modainteract/moda-interact-shared
```

Production services should use the exact package version selected by the
corresponding Moda Interact architecture/release task rather than relying on a
floating version.

## Public entry points

This reference covers the source API at package version **0.13.1**. Prefer the
specific entry point for the contract you consume. Only paths listed in
`package.json` `exports` are public imports; a file under `src` or `dist` is not
necessarily a supported package subpath. Type-only exports require `import type`.

| Import suffix after `@modainteract/moda-interact-shared` | Use it for |
|---|---|
| (none) | Convenience re-exports of internationalization, billing, merchant communications, recovery policy and Shopify contracts only. |
| `/internationalization` | Language/country/currency/time-zone normalization, international context and ICU message catalogue validation/rendering. |
| `/billing` | Billing plan/usage contracts, provider-status normalization, subscription-reconciliation jobs, purchased-credit counters and deterministic billing identifiers. |
| `/recovery-policy` | Recovery offer modes and validation of an already-resolved effective recovery policy. Does not retrieve or decide merchant entitlements. |
| `/whatsapp` | Normalized inbound WhatsApp content/message schemas and parsers. Provider delivery statuses are in `/billing`. |
| `/merchant-communications` | Merchant communication and translation job contracts, constants and validation. |
| `/merchant-communications/node` | Node-only deterministic translation queue-job identifiers. |
| `/shopify` | Shopify commerce/recovery event schemas, parsers, event versions and shared queue contracts. |
| `/shopify/node` | Node-only hashed webhook, checkout, order, recovery and discount-sync job identifiers. |
| `/logging` | Structured logger, levels, redaction and bounded serialization, with logger/sink types. |
| `/logging/node` | Node logging bootstrap, configuration and flushing for process-owned destinations. |
| `/observability` | Lightweight active-trace and observed-span helpers using installed global providers. |
| `/observability/node` | Node OpenTelemetry initialization and lifecycle; import from process preload. |
| `/observability/bullmq` | BullMQ telemetry adapter and options. Use in Node queue/worker configuration. |
| `/observability/genai` | Conversation, agent and tool observation helpers with bounded metrics and span metadata. |
| `/testing/node` | Node-only disposable PostgreSQL/Redis test infrastructure and command helpers; not application startup or production provisioning. |
| `/commerce` | Commerce schemas, definitions, selection helpers, response validation, canonical hashing inputs and synthetic examples. |
| `/commerce/runner` | Dependency-injected Commerce turn runner and model/tool adapter types. |

The root entry does **not** re-export WhatsApp, Commerce, the runner, logging,
observability or Node helpers. Do not replace a documented subpath import with a
root import without checking its exports. `/node` entries and the BullMQ adapter
belong in server processes; keep them out of browser bundles.

The [complete export inventory](#complete-export-inventory) below includes runtime
values and TypeScript types for every public entry point. Existing logging,
observability and Shopify examples follow the Commerce guide.

## Contract parsing and identifiers

Import the producer/consumer's matching schema, then validate untrusted input at
the boundary. A TypeScript type alone does not validate a received payload.

```ts
import { NormalizedWhatsAppInboundMessageSchema } from
  "@modainteract/moda-interact-shared/whatsapp";

// rawPayload is the normalized contract, not a raw Meta webhook body.
function acceptNormalizedMessage(rawPayload: unknown) {
  const parsed = NormalizedWhatsAppInboundMessageSchema.safeParse(rawPayload);
  if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
  return { ok: true as const, message: parsed.data };
}
```

Schemas expose Zod `parse` (throws on invalid input) and `safeParse` (discriminated
success/error result). Named `parse…` / `safeParse…` helpers are available only
where listed in the inventory. Producers and consumers must agree on the event
version; the existence of legacy and newer Shopify exports is not an instruction
to mix their shapes. Use the queue/job identifier helper for the particular
business operation, rather than treating all identifiers as interchangeable.

Internationalization provides normalization and message rendering, not the
application's decision about when to change a conversation language. Effective
recovery policy validation likewise does not load a merchant's current policy.

## Commerce definitions, grants and execution

Commerce is exposed through two explicit imports:

```ts
import {
  ToolBindingsSchema,
  CommerceToolDefinitionSchema,
  CommerceManifestSchema,
  CommerceConversationGrantSchema,
} from "@modainteract/moda-interact-shared/commerce";
import { runCommerceTurn, type RunnerTool } from
  "@modainteract/moda-interact-shared/commerce/runner";
```

### Which structure goes where

| Structure / API | Meaning and owner |
|---|---|
| `ToolBindingSchema`, `ToolBindingsSchema` | Saved `{toolId, toolRevisionId}` associations from a behaviour to exact tool revisions. Studio/Commerce authors these; Background does not populate capability drafts. |
| `CommerceToolDraftDefinitionSchema` | Allows structurally bounded incomplete authoring data. Passing it does not make a draft publishable. |
| `CommerceToolDefinitionSchema` | Full tool name, version, description, input schema, execution definition and response template. Stored/executed by Commerce. |
| `validateDefinitionForPublication` | Uses a supplied `CommerceDefinitionCompiler` to check the full definition, mapped arguments and response-template paths. Commerce supplies schema-backed compilation. |
| `ToolDescriptorSchema`, `definitionToMcpDescriptor` | Full versioned descriptor versus the MCP-facing name/description/inputSchema projection. The server-only execution definition is not exposed as model instructions. |
| `GrantedToolSchema`, `GrantedToolsSchema` | Pinned tool identity, exact revision, name/version and originating capability keys selected for a conversation. |
| `CommerceManifestSchema` | Resolved release, selected capabilities, descriptors, granted tools and response contract. Commerce provides it; callers validate it. |
| `CommerceConversationGrantSchema` | Persisted conversation permission snapshot. Background stores the resolved selection and reuses it on later turns. |
| `CommerceTurnIdentitySchema`, `CommerceAssertionSchema` | Turn identity and resolve/execute assertion shapes. These do not sign or verify JWT signatures; transport/authentication belongs to the services. |
| `selectCapabilities`, `deduplicateTools` | Pure selection and tool-combination helpers over caller-supplied facts. No database or Shopify lookup. |
| `manifestMatchesGrant`, `currentlyGrantedTools` | Compare pinned selection and current availability. Do not replace signature, tenant, lease or persistence checks. |
| `CommerceToolInputs`, `CommerceToolOutputs` | Named supported operation contracts; custom authored inputs still use the validated definition's schema. |
| `CommerceBasketSchema`, `CommerceProductSchema`, `CommerceOfferSchema`, `CommerceEvidenceSchema`, `CommerceAlternativeSchema` | Bounded commerce facts/evidence exchanged between services. Parsing does not prove external facts are true or current. |
| `CommerceToolResultSchema`, `commerceToolResultSchema` | Standard result envelope; the factory accepts a specific data schema. |

A stored binding contains references, not code or model arguments:

```ts
const bindings = ToolBindingsSchema.parse([
  { toolId: "tool_basket", toolRevisionId: "revision_basket_v1" },
  { toolId: "tool_offers", toolRevisionId: "revision_offers_v2" },
]);
```

These identifiers are illustrative. The list allows at most 32 entries with
unique tool IDs; each entry is strict. Publication must additionally verify that
the referenced revision exists, belongs to its tool and is published. Shared
schema parsing cannot check those database relationships.

The normal flow is:

1. Studio saves exact bindings into a behaviour draft; Commerce publishes a fixed
   revision and includes it in a release.
2. Commerce resolves eligible release members using authoritative merchant facts.
3. Background receives the manifest and persists its `grantedTools`, release and
   selected capability keys in a conversation grant.
4. Background checks MCP descriptors against that manifest/grant and constructs
   runtime `RunnerTool` adapters. The model chooses a tool and supplies arguments;
   the adapter forwards execution to Commerce.
5. Later turns reuse the original grant. A new release cannot add tools to that
   conversation; current revocation may remove execution permission.

### Turn runner integration

`RunnerTool` is an in-memory adapter, distinct from the stored tool-binding schema:

```ts
import type { ToolDescriptor, GrantedTool, CommerceToolResult } from
  "@modainteract/moda-interact-shared/commerce";

// Shape of the exported RunnerTool interface, shown for explanation.
type RunnerToolShape = {
  descriptor: ToolDescriptor;
  isAuthorized: (tool: GrantedTool, signal: AbortSignal) => Promise<boolean>;
  execute: (
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<CommerceToolResult>;
  extractEvidence?: (result: CommerceToolResult) => unknown[];
};
```

Import `RunnerTool` rather than copying this explanatory shape. `runCommerceTurn`
takes `RunCommerceTurnInput`: turn, grant, manifest, prompts, host instructions,
trusted context, history, resolved language, abort signal and dependencies. The
host provides `model.invoke`, `tools`, `now` and a canonical-string `digest`
function. Optional budgets bound model steps, remote calls, deadline and output
tokens. The model adapter returns `ModelStep` tool calls and output-token usage;
it does not send a WhatsApp message itself.

The return type is discriminated:

```ts
import type { CommerceFinalResponse } from
  "@modainteract/moda-interact-shared/commerce";
import type { RunnerErrorCode } from
  "@modainteract/moda-interact-shared/commerce/runner";

// Shape of RunCommerceTurnResult, shown for explanation.
type TurnResultShape =
  | { ok: true; result: CommerceFinalResponse;
      usage: { modelSteps: number; remoteCalls: number } }
  | { ok: false; error: { code: RunnerErrorCode; retryable: boolean } };
```

The runner owns bounded orchestration, authorization callbacks and final-response
validation. It does not own an MCP HTTP client, a model SDK, Prisma, conversation
leases or WhatsApp delivery. Background owns those production adapters; preview
can inject isolated fixture/model adapters. Never replace an unavailable
production adapter with `example*` data.

`runnerVersion` describes runner compatibility independently of the npm package
version. `PLATFORM_INSTRUCTIONS` is the runner's fixed grounding, authorization,
language and finalization guidance. Authored capability/release text cannot expand
permissions or override those rules.

### Response contracts and final responses

`CommerceResponseContractSchema` validates the release-owned
`{version: "response.v1", instructions, detailsSchema}` definition.
`EMPTY_RESPONSE_CONTRACT` is the empty-details baseline. Use the supported
`DetailsSchemaSchema` / `InputSchemaSchema` subset rather than assuming arbitrary
JSON Schema keywords are accepted; `validateSubset`, `matchesSubset` and
`compileSubset` expose the same subset validation/matching machinery.

`CommerceFinalResponseSchema` validates the fixed envelope: `answerKind`,
`replyText`, `referralReason`, `detectedLanguageTag`,
`detectedLanguageConfidence`, `evidenceIds` and `details`.
`finalResponseSchema(definition)` additionally validates the selected release's
details schema. `finalResponseToolSchema(definition)` produces the host-local
finalization tool's input schema. `verifyResponseContract` checks the definition
against its hash using the caller's digest implementation.

An ANSWER requires null referral reason; a REFER_TO_STORE response requires the
appropriate reason, empty evidence IDs and empty details. Language detection
fields are either both null or a valid pair. Only reply text is customer-facing;
structured details never authorize actions or replace delivery/routing decisions.

Use `canonicalJson`, `responseContractCanonicalJson`, `toolHashInput` and
`capabilityHashInput` for their specific canonicalization/hashing boundaries.
Do not hash arbitrary object serialization in place of these helpers.
`mapToolArguments` maps validated authored inputs/fixed values; it does not call
Shopify. `POLICY_OPERATIONS` and `POLICY_OPERATION_DESCRIPTORS` describe supported
operation identities; actual provider implementations remain in Commerce.

`exampleTool`, `exampleDefinition`, `exampleTurn`, `exampleManifest`,
`exampleGrant` and `exampleFinal` are synthetic fixtures for examples and tests,
not seeds for a merchant's production configuration.


## What this package owns

The package contains code that genuinely belongs at a cross-service boundary,
including:

- runtime-validated cross-service event contracts;
- TypeScript types shared by producers and consumers;
- schema and event-version constants;
- canonical queue/job-name constants where multiple repositories must agree;
- deterministic correlation/job identifier helpers;
- small pure utilities used by more than one service;
- reusable structured application logging primitives;
- the reusable base Node OpenTelemetry runtime, including tracing and metrics
  providers, exporters, sampling, HTTP/Undici instrumentation, lifecycle, and
  generic observability helpers.

The package deliberately keeps framework and runtime dependencies small.

## Node observability runtime

The package provides a browser-safe semantic observability entry and a
Node-only runtime entry:

```ts
import {
  getActiveTraceId,
  withObservedSpan,
} from "@modainteract/moda-interact-shared/observability";

import {
  initNodeObservability,
} from "@modainteract/moda-interact-shared/observability/node";
```

Import `./observability/node` only from a process preload. It installs tracing,
metrics, HTTP/HTTPS and Undici/fetch instrumentation before framework or worker
modules load:

```text
node --import ./observability.mjs <framework-or-worker-entrypoint>
```

```js
// observability.mjs
import { initNodeObservability } from
  "@modainteract/moda-interact-shared/observability/node";

initNodeObservability({
  serviceName: "moda-interact-messaging",
  environment: process.env.DEPLOYMENT_ENVIRONMENT_NAME,
  instrument: { http: true, fetch: true, prisma: false },
});
```

Set `prisma: true` only for processes that load Prisma, and keep the preload
before the first Prisma application import.

The runtime uses the canonical `service.namespace`, `service.name`, and
`deployment.environment.name` resource attributes. It honors
`OTEL_TRACES_SAMPLER`, ratio arguments for ratio samplers, signal-specific or
generic OTLP endpoints, and bounded batch/export settings. With no trace or
metric endpoint those pipelines are no-ops while structured stdout logging
continues.

`forceFlush()` covers traces, metrics, OpenTelemetry Logs, and direct Loki.
Initialization, export, flush, and shutdown failures are best-effort and do not
become application startup or business-operation failures.

### BullMQ telemetry

Create the shared BullMQ telemetry adapter once per Queue or Worker options
object and pass it through BullMQ's native `telemetry` option:

```ts
import { createBullMQTelemetry } from
  "@modainteract/moda-interact-shared/observability/bullmq";

const telemetry = createBullMQTelemetry({
  serviceName: "moda-messaging-worker",
  enableMetrics: true,
});

new Worker(queueName, processor, { connection, telemetry });
```

The adapter uses the global trace and meter providers installed by the Node
runtime. BullMQ owns propagation metadata in its job options; applications must
not copy or mutate queue payloads solely to carry trace context. BullMQ metrics
use queue name, bounded job name, and job state dimensions, never Moda job,
shop, checkout, conversation, or message IDs.

### GenAI active spans

Use the GenAI helpers to model one inbound conversation turn as an independent
trace with active agent, tool, and automatically instrumented child spans:

```ts
import {
  observeAgentInvocation,
  observeAgentTool,
  observeConversationTurn,
} from "@modainteract/moda-interact-shared/observability/genai";

await observeConversationTurn("whatsapp", () =>
  observeAgentInvocation({ agentName: "commerce-agent" }, () =>
    observeAgentTool("lookup-products", executeTool),
  ),
);
```

Pass `recordMetrics: false` to activate a helper's span without recording its
GenAI metrics. The option applies only to that helper invocation, so pass it to
each nested helper whose metrics should be suppressed:

```ts
const spansOnly = { recordMetrics: false } as const;

await observeConversationTurn("whatsapp", () =>
  observeAgentInvocation({ agentName: "commerce-agent" }, () =>
    observeAgentTool("lookup-products", executeTool, spansOnly),
    spansOnly,
  ),
  spansOnly,
);
```

An optional `mapException` callback can replace the application failure with a
bounded telemetry-safe representation for `span.recordException`. The original
thrown value is still rethrown unchanged. If the mapper throws or returns no
usable fields, the exception event is omitted and the span remains `ERROR`;
the original value is never recorded as fallback. Apply the mapper to every
nested helper that may observe the same rethrown failure:

```ts
const safeObservation = {
  recordMetrics: false,
  mapException: () => ({
    name: "ProviderError",
    message: "Provider operation failed",
  }),
} as const;

await observeAgentTool("lookup-products", executeTool, safeObservation);
```

The helpers use only the global tracer and meter providers installed by the
Node runtime. They create no SDK, provider, exporter, or network request, and
remain lightweight no-ops when providers are absent. Six module-singleton
instruments record turn, agent, and tool duration and operation outcomes.
Metric attributes are limited to `outcome=success|error`; turn metrics also use
the closed `channel=whatsapp|other` vocabulary. Arbitrary agent, provider,
model, tool, and Moda business identifiers never become metric dimensions.

Agent, provider, model, and tool names are trimmed and bounded on spans only.
Prompt, completion, message, and tool payload bodies are never accepted or
captured by default.

## What this package does not own

This package does **not** own:

- Prisma models or database migrations;
- PostgreSQL persistence;
- BullMQ/Redis clients or worker processes;
- Shopify or Meta webhook HTTP handlers;
- Shopify or Meta SDK integration;
- application recovery/business logic;
- service/domain-specific span names, business attributes, or application
  metrics;
- deployment OTLP endpoint/credential wiring or observability backends;
- Render deployment configuration.

Those service-specific semantics and deployment concerns remain in the
repository that owns the corresponding runtime.

---

# Shopify contracts

Moda Interact uses the shared Shopify package boundary so webhook producers and
background consumers do not independently invent compatible-looking event
types.

Import Shopify contracts from:

```ts
import {
  // schemas, parsers, constants and types
} from "@modainteract/moda-interact-shared/shopify";
```

Node-only Shopify helpers are isolated under:

```ts
import {
  createShopifyWebhookJobId,
} from "@modainteract/moda-interact-shared/shopify/node";
```

The Node-only subpath prevents `node:` built-ins from being accidentally pulled
into consumers that only need the browser-safe Shopify contract entry point.

## Recovery-focused events

The current recovery architecture defines distinct event meanings for:

```text
checkout.created
checkout.updated
order.completed
```

Pre-recovery checkout events deliberately avoid transporting customer identity,
line-item, pricing and address data merely because those values existed in the
provider webhook.

Consumers must parse/validate cross-service data with the shared runtime
contracts before acting on it. TypeScript types alone are not a trust boundary.

## Contract versioning

Serialized event schema versions and the npm package version are separate
concepts.

A breaking change to an existing serialized event contract requires an
appropriate event-schema version change and coordinated producer/consumer
rollout.

An additive npm package capability, such as a new independent package export,
does not by itself require changing an unrelated serialized event schema.

---

# Structured logging

Moda Interact runtime services use one reusable structured logging primitive:

```ts
import {
  createLogger,
  type StructuredLogger,
  type LogFields,
} from "@modainteract/moda-interact-shared/logging";
```

## Create a logger

Each deployable service/process supplies its own identity and environment:

```ts
const logger = createLogger({
  serviceName: "moda-interact",
  environment: "test",
});
```

The default namespace is:

```text
moda-interact
```

Logs contain the canonical identity:

```text
service.namespace=moda-interact
service.name=<service/process name>
deployment.environment.name=<environment>
```

For deployed Moda Interact environments, the expected environment values are:

```text
test
production
```

The shared library does not read a service's environment variables for it.
The owning service resolves its configuration and passes the resulting
environment to `createLogger`.

## Write logs

```ts
logger.info("shopify.webhook.outcome", {
  topic: "checkouts/create",
  outcome: "ENQUEUED",
  ackMs: 18,
});

logger.warn("queue.job.retry", {
  queue: "recovery",
  attempt: 2,
});

logger.error("recovery.failed", {
  recoveryId,
  error,
});
```

The default sink emits one structured JSON record per console call.

Example:

```json
{
  "timestamp": "2026-08-30T12:00:00.000Z",
  "level": "info",
  "event": "shopify.webhook.outcome",
  "service.namespace": "moda-interact",
  "service.name": "moda-interact",
  "deployment.environment.name": "test",
  "data": {
    "topic": "checkouts/create",
    "outcome": "ENQUEUED",
    "ackMs": 18
  }
}
```

## Log levels

Available levels are:

```text
debug
info
warn
error
```

Use stable, machine-readable event names such as:

```text
shopify.webhook.outcome
meta.webhook.outcome
queue.job.started
queue.job.completed
queue.job.failed
recovery.materialized
```

## Child loggers

`child()` is optional.

It creates another logger with some repeated fields already attached. It does
**not** create a worker, queue, process, connection, or logging service.

Instead of repeatedly writing:

```ts
logger.info("queue.job.started", {
  queue: "recovery",
  jobId,
});

logger.info("queue.job.completed", {
  queue: "recovery",
  jobId,
});
```

you may write:

```ts
const recoveryLogger = logger.child({
  queue: "recovery",
});

recoveryLogger.info("queue.job.started", {
  jobId,
});

recoveryLogger.info("queue.job.completed", {
  jobId,
});
```

Both records automatically contain:

```json
{
  "queue": "recovery"
}
```

Use child context only for stable, safe operational fields.

## Sensitive data

The logger provides defense-in-depth redaction and bounded serialization, but
callers remain responsible for constructing safe, explicit log fields.

Do not intentionally log:

- access or refresh tokens;
- authorization headers;
- cookies;
- OAuth codes;
- passwords or API keys;
- private keys;
- webhook verification secrets;
- complete webhook/request/response payloads;
- customer names, email addresses, phone numbers or postal addresses;
- payment/card data.

Do not pass a complete provider/customer object to the logger and rely on
redaction to make it safe.

## Errors

Errors can be logged as values:

```ts
logger.error("queue.job.failed", {
  jobId,
  error,
});
```

The shared logger safely serializes `Error` objects without emitting stack
traces by default.

Logging is best-effort: a logger sink or serialization failure must not alter
the success/failure semantics of the business operation being logged.

## Logging destinations

Every call to the shared logger:

```ts
logger.debug(...)
logger.info(...)
logger.warn(...)
logger.error(...)
```

emits the same already-sanitized canonical record to up to three independent,
best-effort destinations:

1. canonical structured JSON to the configured sink (default: console);
2. the OpenTelemetry Logs API via the global `LoggerProvider`, if one has been
   installed;
3. a direct Grafana Loki transport, if the Node process bootstrap has installed
   the Loki emitter.

Each destination is failure-isolated: a failure in one must not suppress
another and must never affect application/business correctness.

The OpenTelemetry API is a no-op when no provider is installed, so stdout
logging continues to work in local/test environments without any backend.

The heavy Node SDK/exporter and the Winston/winston-loki transport are isolated
in:

```text
@modainteract/moda-interact-shared/logging/node
```

and must be imported and initialized only from the Node process bootstrap —
never through Vite/application/browser bundles.

```text
application module
    |
    v
@modainteract/moda-interact-shared/logging
    |
    +--> canonical JSON stdout
    |
    +--> @opentelemetry/api-logs
    |        |
    |        | global LoggerProvider
    |        v
    |   ./logging/node
    |        |
    |        +--> LoggerProvider
    |        +--> BatchLogRecordProcessor
    |        +--> OTLPLogExporter
    |                 |
    |                 v
    |              /v1/logs
    |
    +--> lightweight Loki bridge (globalThis emitter)
             |
             v
        ./logging/node
             |
             +--> Winston + winston-loki
                      |
                      v
                  Grafana Loki
```

Winston and winston-loki exist **only** in the Node-only package graph. The
normal `./logging` entry contains no Winston, winston-loki or Node networking
imports.

### Node bootstrap

Process bootstrap code installs the optional destinations once:

```ts
import {
  initNodeLokiLogging,
  initNodeOpenTelemetryLogging,
} from "@modainteract/moda-interact-shared/logging/node";

initNodeLokiLogging({
  serviceName: "moda-interact",
  environment: "production",
});

initNodeOpenTelemetryLogging({
  serviceName: "moda-interact",
  environment: "production",
});
```

Each destination is independently configurable, so a deployment may use:

```text
console only

console + Loki

console + OTel Logs

console + Loki + OTel Logs
```

Either Node destination may be omitted entirely; without an installed
provider/emitter the logger remains a safe stdout-only logger.

The bootstrap supports the standard OpenTelemetry environment variables:

```text
OTEL_SDK_DISABLED

OTEL_LOGS_EXPORTER

OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
OTEL_EXPORTER_OTLP_ENDPOINT

OTEL_EXPORTER_OTLP_LOGS_HEADERS
OTEL_EXPORTER_OTLP_HEADERS

OTEL_BLRP_MAX_QUEUE_SIZE
OTEL_BLRP_MAX_EXPORT_BATCH_SIZE
OTEL_BLRP_SCHEDULE_DELAY
OTEL_BLRP_EXPORT_TIMEOUT

OTEL_LOG_EXPORT_CONCURRENCY_LIMIT
```

Endpoint rules:

```text
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
    exact signal endpoint; do not append /v1/logs

OTEL_EXPORTER_OTLP_ENDPOINT
    generic endpoint; append /v1/logs
```

Moda deliberately does **not** export to the OpenTelemetry default localhost
endpoint. Without an explicitly configured endpoint the logger remains
stdout-only.

### Direct Loki transport

The direct Loki transport is a lightweight bridge: the normal `./logging` entry
stores an emitter on `globalThis` and the Node bootstrap installs it. Records
still pass through the same shared redaction/sanitization used for stdout and
OpenTelemetry.

The Loki environment contract is:

```text
LOKI_ENABLED

LOKI_URL

LOKI_USERNAME
LOKI_PASSWORD

LOKI_BATCHING
LOKI_BATCH_INTERVAL_SECONDS
LOKI_TIMEOUT_MS
LOKI_CLEAR_ON_ERROR
```

Rules:

```text
no LOKI_URL
    -> direct Loki disabled

LOKI_ENABLED=false
    -> direct Loki disabled

LOKI_URL present
    -> direct Loki enabled by default
```

Credentials are Node-bootstrap configuration only. Never log `LOKI_URL`
credentials, `LOKI_USERNAME`, `LOKI_PASSWORD`, Basic Auth values or connection
headers.

Default transport behavior:

```text
batching=true
bounded timeout (LOKI_TIMEOUT_MS)
clearOnError=true
replaceTimestamp=true
gracefulShutdown=false
```

The owning process bootstrap is responsible for explicit flush/shutdown via the
returned runtime (`forceFlush`/`shutdown`). If Loki is unavailable, log records
may be dropped but application processing must continue. Connection errors are
not recursively written back through the shared logger.

### Loki labels and cardinality

Moda explicitly configures exactly three canonical low-cardinality labels:

```text
service_namespace
service_name
environment
```

`winston-loki@6.1.7` additionally adds its own low-cardinality `level` label
to every pushed stream, so a stream carries the three Moda labels plus
`level`. This is transport-library behaviour and does not change Moda's label
configuration.

Dynamic/high-cardinality identifiers must **not** be promoted to Loki stream
labels. The implementation explicitly retains
`useWinstonMetaAsLabels: false`, so winston metadata is never promoted to
labels. In particular, do not label by:

```text
traceId
spanId
requestId
jobId
deliveryId
eventId
recoveryId
checkoutToken
cartToken
shop
shopDomain
customerId
phone
email
```

Safe high-cardinality operational identifiers may remain in the sanitized JSON
log body where justified, but they must never become indexed stream labels.

### Duplicate-delivery warning

Do not route the OpenTelemetry Logs destination back into the same Loki
instance while direct Loki is also enabled, unless duplicate storage is
intentional:

```text
direct Loki ON
+
OTel Logs ultimately routed to same Loki
=
duplicate log storage
```

The library does not guess backend topology; deployment configuration owns this
choice.

### Log-signal data safety and correlation

- The OpenTelemetry log body is `JSON.stringify` of the same canonical
  sanitized `LogRecord` written to stdout, so the same redaction boundary
  applies to both destinations.
- Queryable OTel attributes are limited to:

  ```text
  event.name
  log.level
  service.namespace
  service.name
  deployment.environment.name
  ```

- The shared logger never manufactures trace IDs. If an active
  trace/span context exists, the OpenTelemetry Logs SDK associates the emitted
  record with that active context automatically.
- stdout and OpenTelemetry emission are isolated and best-effort: a failure in
  either must not change application/business correctness.

### Tracing/metrics ownership

The shared logger does **not** create spans, counters or histograms.

The shared observability runtime owns the generic Node SDK, tracing and metrics
provider mechanics, exporters, sampling, HTTP/Undici instrumentation, generic
helpers, and lifecycle. Service repositories own their span names, business
attributes, application-specific metrics, and domain semantics, for example:

```text
Shopify operation
    |
    +--> shared structured logger (stdout + OTel Logs)
    |
    +--> Shopify-specific OpenTelemetry (spans/metrics)
```

This separation is intentional. Fields that are useful in diagnostic logs can
have very different cardinality constraints from metric attributes.

---

# Package exports

The public package exposes independent entry points.

```text
@modainteract/moda-interact-shared
    existing root exports

@modainteract/moda-interact-shared/shopify
    Shopify cross-service contracts, schemas, constants and pure helpers

@modainteract/moda-interact-shared/shopify/node
    Node-only Shopify helpers

@modainteract/moda-interact-shared/logging
    reusable structured logging API
    (stdout + OTel Logs + direct Loki fan-out)

@modainteract/moda-interact-shared/logging/node
    Node-only logging bootstrap
    (OpenTelemetry LoggerProvider, batching, OTLP HTTP exporter;
     Winston + winston-loki direct transport)

@modainteract/moda-interact-shared/observability
    browser-safe generic observability helpers

@modainteract/moda-interact-shared/observability/node
    reusable Node OpenTelemetry SDK, tracing/metrics providers, exporters,
    sampling, HTTP/Undici instrumentation, and lifecycle

@modainteract/moda-interact-shared/observability/bullmq
    Node-only BullMQ native telemetry adapter

@modainteract/moda-interact-shared/observability/genai
    Node/runtime GenAI conversation-turn, agent, and tool active-span helpers
```

Consumers should prefer the narrowest appropriate subpath.

---

# Ownership boundary

Examples of repository ownership:

**moda-interact**

- authenticates Shopify ingress;
- normalizes/validates Shopify events;
- publishes the appropriate queue jobs;
- uses the shared structured logger for generic log mechanics;
- uses the shared observability runtime for generic OpenTelemetry mechanics;
- owns Shopify-specific observability semantics and application metrics.

**moda-interact-background**

- parses shared cross-service contracts before acting;
- runs BullMQ workers and recovery workflows;
- uses the shared logger for generic structured logging;
- uses the shared observability runtime for generic OpenTelemetry mechanics;
- owns worker/recovery observability semantics and application metrics.

**moda-interact-messaging**

- owns Meta/WhatsApp ingress;
- uses the shared logger for generic structured logging;
- uses the shared observability runtime for generic OpenTelemetry mechanics;
- owns Meta/WhatsApp-specific observability semantics and application metrics.

**moda-interact-admin**

- owns the internal admin application;
- may use the same shared logger where server-side operational logging is
  required;
- uses the shared observability runtime for generic OpenTelemetry mechanics;
- owns admin-specific observability semantics and application metrics.

**moda-interact-database**

- owns Prisma schema/migrations and database artifacts;
- does not duplicate shared TypeScript transport contracts.

---

# Development

## Typecheck

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Inspect the publish artifact

Before publishing:

```bash
npm pack --dry-run
```

Verify that the intended JavaScript and type declarations for every public
subpath are included.

---

# Release policy

The npm package version follows semantic versioning.

Examples:

```text
patch
    backwards-compatible fix to an existing package capability

minor
    backwards-compatible new public capability/export

major
    breaking public API/package compatibility change
```

The addition of the independent `./logging` public API is an additive package
capability and should therefore be released as a **minor** version increment.

Publishing the package and changing consuming services are coordinated tasks;
a consuming service must not assume an unpublished local shared export exists
in the npm artifact it installs.

## Complete export inventory
Enumerated from the TypeScript module exports for every `package.json` public
entry point, including re-exports and type-only symbols. Source files are linked
for exact signatures, fields, defaults and validation constraints. This inventory
does not make internal modules into public import paths. When changing exports,
update both the entry-point guide and this inventory.

<details>
<summary>Package root — 182 exports</summary>

Import: `@modainteract/moda-interact-shared`.

From [src/billing.ts](src/billing.ts):

Runtime exports:

- `APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS`
- `ARCH007_BILLING_CONTRACT_SCHEMA_VERSION`
- `availablePurchasedRecoveryCredits`
- `BILLING_PLAN_KINDS`
- `BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME`
- `BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME`
- `BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION`
- `BILLING_SYSTEM_MESSAGE_CODES`
- `BILLING_USAGE_METRICS`
- `BillingPlanKindSchema`
- `BillingSubscriptionReconcileJobSchema`
- `BillingSystemMessageCodeSchema`
- `BillingUsageMetricSchema`
- `createBillingSubscriptionReconcileJobId`
- `createMerchantBillingSystemSourceKey`
- `createRecoveryIdempotencyKey`
- `createShopifyUsageIdempotencyKey`
- `deriveShopifyProviderContextIdentity`
- `isSameShopifyPurchaseProviderContext`
- `NormalizedWhatsAppStatusSchema`
- `parseBillingSubscriptionReconcileJob`
- `parseNormalizedWhatsAppStatus`
- `safeParseBillingSubscriptionReconcileJob`
- `safeParseNormalizedWhatsAppStatus`
- `WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION`
- `WHATSAPP_PROVIDER_STATUSES`
- `WhatsAppProviderPricingMetadataSchema`
- `WhatsAppProviderStatusSchema`

Type-only exports:

- `BillingPlanKind`
- `BillingSubscriptionReconcileJob`
- `BillingSystemMessageCode`
- `BillingUsageMetric`
- `NormalizedWhatsAppStatus`
- `PurchasedRecoveryCreditCounterSnapshot`
- `ShopifyCurrentProviderContext`
- `ShopifyProviderContextIdentityInput`
- `ShopifyPurchaseProviderContext`
- `WhatsAppProviderPricingMetadata`
- `WhatsAppProviderStatus`

From [src/internationalization.ts](src/internationalization.ts):

Runtime exports:

- `canonicaliseLanguageTag`
- `CountryCodeSchema`
- `createInternationalizationRuntime`
- `CurrencyCodeSchema`
- `InternationalContextSchema`
- `LanguageSourceSchema`
- `LanguageTagSchema`
- `mergeInternationalContext`
- `normalizeCountryCode`
- `normalizeCurrencyCode`
- `normalizeTimeZone`
- `resolveLocaleDirection`
- `TimeZoneIdSchema`
- `validateIcuCatalogue`

Type-only exports:

- `CatalogueValidationOptions`
- `CountryCode`
- `CurrencyCode`
- `IcuMessageCatalogue`
- `IcuMessageValues`
- `InternationalContext`
- `InternationalizationRuntime`
- `InternationalizationRuntimeOptions`
- `LanguageSource`
- `LanguageTag`
- `TimeZoneId`

From [src/merchant-communications.ts](src/merchant-communications.ts):

Runtime exports:

- `AuthoredSupportBodySchema`
- `countUnicodeGraphemes`
- `MERCHANT_COMMUNICATIONS_JOB_NAMES`
- `MERCHANT_COMMUNICATIONS_QUEUE_NAME`
- `MERCHANT_COMMUNICATIONS_SCHEMA_VERSION`
- `MerchantMessageTranslationContractSchema`
- `MerchantMessageTranslationStatusSchema`
- `MerchantSupportMessageContractSchema`
- `MerchantSupportMessageKindSchema`
- `MerchantSupportMessageStateSchema`
- `MerchantTranslationBatchContractSchema`
- `MerchantTranslationBatchStatusSchema`
- `MerchantTranslationDirectionSchema`
- `MerchantTranslationReconciliationRequestContractSchema`
- `MerchantTranslationReconciliationScopeSchema`
- `MerchantTranslationReconciliationStatusSchema`
- `PLATFORM_SUPPORT_LANGUAGE_TAG`
- `requiresMerchantTranslation`
- `TranslatedSupportBodySchema`
- `TranslationBatchPollJobSchema`
- `TranslationBatchResultsJobSchema`
- `TranslationBatchSubmitJobSchema`
- `TranslationDispatchJobSchema`
- `TranslationReconcileJobSchema`

Type-only exports:

- `MerchantMessageTranslationContract`
- `MerchantMessageTranslationStatus`
- `MerchantSupportMessageContract`
- `MerchantSupportMessageKind`
- `MerchantSupportMessageState`
- `MerchantTranslationBatchContract`
- `MerchantTranslationBatchStatus`
- `MerchantTranslationDirection`
- `MerchantTranslationReconciliationRequestContract`
- `MerchantTranslationReconciliationScope`
- `MerchantTranslationReconciliationStatus`
- `TranslationBatchPollJob`
- `TranslationBatchResultsJob`
- `TranslationBatchSubmitJob`
- `TranslationDispatchJob`
- `TranslationReconcileJob`

From [src/recovery-policy.ts](src/recovery-policy.ts):

Runtime exports:

- `EffectiveRecoveryPolicySchema`
- `parseEffectiveRecoveryPolicy`
- `RECOVERY_OFFER_MODES`
- `RecoveryOfferModeSchema`
- `safeParseEffectiveRecoveryPolicy`

Type-only exports:

- `EffectiveRecoveryPolicy`
- `RecoveryOfferMode`

From [src/shopify/common.schema.ts](src/shopify/common.schema.ts):

Runtime exports:

- `MAX_LINE_ITEMS`
- `MAX_URL_LENGTH`
- `ShopifyCheckoutLineItemSchema`
- `ShopifyCheckoutLineItemsSchema`
- `ShopifyCustomerReferenceSchema`
- `ShopifyMoneySchema`
- `ShopifyTenantSchema`

Type-only exports:

- `ShopifyCheckoutLineItem`
- `ShopifyCustomerReference`
- `ShopifyMoney`
- `ShopifyTenant`

From [src/shopify/constants.ts](src/shopify/constants.ts):

Runtime exports:

- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION`
- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V1`
- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2`
- `SHOPIFY_COMMERCE_EVENT_TYPES`
- `SHOPIFY_RECOVERY_EVENT_TYPES_V2`
- `SHOPIFY_WEBHOOK_OUTBOX_DESTINATIONS`

From [src/shopify/queue-contracts.ts](src/shopify/queue-contracts.ts):

Runtime exports:

- `parseShopifyDiscountSyncJob`
- `safeParseShopifyDiscountSyncJob`
- `SHOPIFY_DISCOUNT_SYNC_REASONS`
- `SHOPIFY_DISCOUNT_SYNC_WEBHOOK_TOPICS`
- `SHOPIFY_WEBHOOK_QUEUE_CONTRACTS`
- `ShopifyDiscountSyncJobSchema`
- `ShopifyDiscountSyncReasonSchema`
- `ShopifyDiscountSyncWebhookTopicSchema`

Type-only exports:

- `ShopifyDiscountSyncJob`

From [src/shopify/v1/checkout-observed.schema.ts](src/shopify/v1/checkout-observed.schema.ts):

Runtime exports:

- `CheckoutObservedPayloadSchema`

Type-only exports:

- `CheckoutObservedPayload`

From [src/shopify/v1/commerce-event.schema.ts](src/shopify/v1/commerce-event.schema.ts):

Runtime exports:

- `createShopifyCommerceOrderingKey`
- `createShopifyOrderOrderingKey`
- `isCheckoutObservedEvent`
- `isOrderCompletedEvent`
- `parseShopifyCommerceEvent`
- `safeParseShopifyCommerceEvent`
- `ShopifyCheckoutObservedEventSchema`
- `ShopifyCommerceEventSchema`
- `ShopifyOrderCompletedEventSchema`

Type-only exports:

- `ShopifyCheckoutObservedEvent`
- `ShopifyCommerceEvent`
- `ShopifyCommerceEventType`
- `ShopifyOrderCompletedEvent`

From [src/shopify/v1/order-completed.schema.ts](src/shopify/v1/order-completed.schema.ts):

Runtime exports:

- `OrderCompletedPayloadSchema`

Type-only exports:

- `OrderCompletedPayload`

From [src/shopify/v2/cart-activity.schema.ts](src/shopify/v2/cart-activity.schema.ts):

Runtime exports:

- `ShopifyCartActivityPayloadV2Schema`

Type-only exports:

- `ShopifyCartActivityPayloadV2`

From [src/shopify/v2/checkout-created.schema.ts](src/shopify/v2/checkout-created.schema.ts):

Runtime exports:

- `CheckoutCreatedPayloadV2Schema`

Type-only exports:

- `CheckoutCreatedPayloadV2`

From [src/shopify/v2/checkout-updated.schema.ts](src/shopify/v2/checkout-updated.schema.ts):

Runtime exports:

- `CheckoutUpdatedPayloadV2Schema`

Type-only exports:

- `CheckoutUpdatedPayloadV2`

From [src/shopify/v2/order-completed.schema.ts](src/shopify/v2/order-completed.schema.ts):

Runtime exports:

- `OrderCompletedPayloadV2Schema`

Type-only exports:

- `OrderCompletedPayloadV2`

From [src/shopify/v2/recovery-event.schema.ts](src/shopify/v2/recovery-event.schema.ts):

Runtime exports:

- `createShopifyCartActivityOrderingKey`
- `createShopifyOrderCorrelationOrderingKey`
- `createShopifyPendingRecoveryOrderingKey`
- `isCartActivityEventV2`
- `isCheckoutCreatedEventV2`
- `isCheckoutUpdatedEventV2`
- `isOrderCompletedEventV2`
- `parseShopifyRecoveryEventV2`
- `safeParseShopifyRecoveryEventV2`
- `ShopifyCartActivityEventV2Schema`
- `ShopifyCheckoutCreatedEventV2Schema`
- `ShopifyCheckoutUpdatedEventV2Schema`
- `ShopifyOrderCompletedEventV2Schema`
- `ShopifyRecoveryEventV2Schema`

Type-only exports:

- `ShopifyCartActivityEventV2`
- `ShopifyCheckoutCreatedEventV2`
- `ShopifyCheckoutUpdatedEventV2`
- `ShopifyOrderCompletedEventV2`
- `ShopifyRecoveryEventTypeV2`
- `ShopifyRecoveryEventV2`

</details>

<details>
<summary>/internationalization — 25 exports</summary>

Import: `@modainteract/moda-interact-shared/internationalization`.

From [src/internationalization.ts](src/internationalization.ts):

Runtime exports:

- `canonicaliseLanguageTag`
- `CountryCodeSchema`
- `createInternationalizationRuntime`
- `CurrencyCodeSchema`
- `InternationalContextSchema`
- `LanguageSourceSchema`
- `LanguageTagSchema`
- `mergeInternationalContext`
- `normalizeCountryCode`
- `normalizeCurrencyCode`
- `normalizeTimeZone`
- `resolveLocaleDirection`
- `TimeZoneIdSchema`
- `validateIcuCatalogue`

Type-only exports:

- `CatalogueValidationOptions`
- `CountryCode`
- `CurrencyCode`
- `IcuMessageCatalogue`
- `IcuMessageValues`
- `InternationalContext`
- `InternationalizationRuntime`
- `InternationalizationRuntimeOptions`
- `LanguageSource`
- `LanguageTag`
- `TimeZoneId`

</details>

<details>
<summary>/billing — 39 exports</summary>

Import: `@modainteract/moda-interact-shared/billing`.

From [src/billing.ts](src/billing.ts):

Runtime exports:

- `APP_PRICING_BILLING_PERIOD_DRAIN_WINDOW_MS`
- `ARCH007_BILLING_CONTRACT_SCHEMA_VERSION`
- `availablePurchasedRecoveryCredits`
- `BILLING_PLAN_KINDS`
- `BILLING_SUBSCRIPTION_RECONCILE_JOB_NAME`
- `BILLING_SUBSCRIPTION_RECONCILE_QUEUE_NAME`
- `BILLING_SUBSCRIPTION_RECONCILE_SCHEMA_VERSION`
- `BILLING_SYSTEM_MESSAGE_CODES`
- `BILLING_USAGE_METRICS`
- `BillingPlanKindSchema`
- `BillingSubscriptionReconcileJobSchema`
- `BillingSystemMessageCodeSchema`
- `BillingUsageMetricSchema`
- `createBillingSubscriptionReconcileJobId`
- `createMerchantBillingSystemSourceKey`
- `createRecoveryIdempotencyKey`
- `createShopifyUsageIdempotencyKey`
- `deriveShopifyProviderContextIdentity`
- `isSameShopifyPurchaseProviderContext`
- `NormalizedWhatsAppStatusSchema`
- `parseBillingSubscriptionReconcileJob`
- `parseNormalizedWhatsAppStatus`
- `safeParseBillingSubscriptionReconcileJob`
- `safeParseNormalizedWhatsAppStatus`
- `WHATSAPP_PROVIDER_STATUS_SCHEMA_VERSION`
- `WHATSAPP_PROVIDER_STATUSES`
- `WhatsAppProviderPricingMetadataSchema`
- `WhatsAppProviderStatusSchema`

Type-only exports:

- `BillingPlanKind`
- `BillingSubscriptionReconcileJob`
- `BillingSystemMessageCode`
- `BillingUsageMetric`
- `NormalizedWhatsAppStatus`
- `PurchasedRecoveryCreditCounterSnapshot`
- `ShopifyCurrentProviderContext`
- `ShopifyProviderContextIdentityInput`
- `ShopifyPurchaseProviderContext`
- `WhatsAppProviderPricingMetadata`
- `WhatsAppProviderStatus`

</details>

<details>
<summary>/recovery-policy — 7 exports</summary>

Import: `@modainteract/moda-interact-shared/recovery-policy`.

From [src/recovery-policy.ts](src/recovery-policy.ts):

Runtime exports:

- `EffectiveRecoveryPolicySchema`
- `parseEffectiveRecoveryPolicy`
- `RECOVERY_OFFER_MODES`
- `RecoveryOfferModeSchema`
- `safeParseEffectiveRecoveryPolicy`

Type-only exports:

- `EffectiveRecoveryPolicy`
- `RecoveryOfferMode`

</details>

<details>
<summary>/whatsapp — 7 exports</summary>

Import: `@modainteract/moda-interact-shared/whatsapp`.

From [src/whatsapp.ts](src/whatsapp.ts):

Runtime exports:

- `NormalizedWhatsAppInboundMessageSchema`
- `parseNormalizedWhatsAppInboundMessage`
- `safeParseNormalizedWhatsAppInboundMessage`
- `WHATSAPP_INBOUND_MESSAGE_SCHEMA_VERSION`
- `WhatsAppInboundContentSchema`

Type-only exports:

- `NormalizedWhatsAppInboundMessage`
- `WhatsAppInboundContent`

</details>

<details>
<summary>/merchant-communications — 40 exports</summary>

Import: `@modainteract/moda-interact-shared/merchant-communications`.

From [src/merchant-communications.ts](src/merchant-communications.ts):

Runtime exports:

- `AuthoredSupportBodySchema`
- `countUnicodeGraphemes`
- `MERCHANT_COMMUNICATIONS_JOB_NAMES`
- `MERCHANT_COMMUNICATIONS_QUEUE_NAME`
- `MERCHANT_COMMUNICATIONS_SCHEMA_VERSION`
- `MerchantMessageTranslationContractSchema`
- `MerchantMessageTranslationStatusSchema`
- `MerchantSupportMessageContractSchema`
- `MerchantSupportMessageKindSchema`
- `MerchantSupportMessageStateSchema`
- `MerchantTranslationBatchContractSchema`
- `MerchantTranslationBatchStatusSchema`
- `MerchantTranslationDirectionSchema`
- `MerchantTranslationReconciliationRequestContractSchema`
- `MerchantTranslationReconciliationScopeSchema`
- `MerchantTranslationReconciliationStatusSchema`
- `PLATFORM_SUPPORT_LANGUAGE_TAG`
- `requiresMerchantTranslation`
- `TranslatedSupportBodySchema`
- `TranslationBatchPollJobSchema`
- `TranslationBatchResultsJobSchema`
- `TranslationBatchSubmitJobSchema`
- `TranslationDispatchJobSchema`
- `TranslationReconcileJobSchema`

Type-only exports:

- `MerchantMessageTranslationContract`
- `MerchantMessageTranslationStatus`
- `MerchantSupportMessageContract`
- `MerchantSupportMessageKind`
- `MerchantSupportMessageState`
- `MerchantTranslationBatchContract`
- `MerchantTranslationBatchStatus`
- `MerchantTranslationDirection`
- `MerchantTranslationReconciliationRequestContract`
- `MerchantTranslationReconciliationScope`
- `MerchantTranslationReconciliationStatus`
- `TranslationBatchPollJob`
- `TranslationBatchResultsJob`
- `TranslationBatchSubmitJob`
- `TranslationDispatchJob`
- `TranslationReconcileJob`

</details>

<details>
<summary>/merchant-communications/node — 5 exports</summary>

Import: `@modainteract/moda-interact-shared/merchant-communications/node`.

From [src/merchant-communications.node.ts](src/merchant-communications.node.ts):

Runtime exports:

- `createTranslationBatchPollJobId`
- `createTranslationBatchResultsJobId`
- `createTranslationBatchSubmitJobId`
- `createTranslationDispatchJobId`
- `createTranslationReconcileJobId`

</details>

<details>
<summary>/testing/node — 27 exports</summary>

Import: `@modainteract/moda-interact-shared/testing/node`.

From [src/testing/node.ts](src/testing/node.ts):

Runtime exports:

- `createCommandRunner`
- `createDockerRunner`
- `DEFAULT_COMMAND_TIMEOUT_MS`
- `DEFAULT_DOCKER_COMMAND_TIMEOUT_MS`
- `DEFAULT_HOST`
- `DEFAULT_POLL_INTERVAL_MS`
- `DEFAULT_POSTGRES_IMAGE`
- `DEFAULT_POSTGRES_STARTUP_TIMEOUT_MS`
- `DEFAULT_REDIS_IMAGE`
- `DEFAULT_REDIS_STARTUP_TIMEOUT_MS`
- `deployPrismaMigrations`
- `EphemeralPostgres`
- `EphemeralRedis`
- `withDisposableIntegrationInfrastructure`

Type-only exports:

- `CommandOptions`
- `CommandResult`
- `CommandRunner`
- `DisposableEnvironment`
- `DisposableIntegrationCallback`
- `DisposableIntegrationInfrastructure`
- `DisposableIntegrationInfrastructureOptions`
- `DockerRunner`
- `EphemeralPostgresOptions`
- `EphemeralRedisOptions`
- `MigrationDeployOptions`
- `PostgresConnectionDetails`
- `RedisConnectionDetails`

</details>

<details>
<summary>/shopify — 71 exports</summary>

Import: `@modainteract/moda-interact-shared/shopify`.

From [src/shopify/common.schema.ts](src/shopify/common.schema.ts):

Runtime exports:

- `MAX_LINE_ITEMS`
- `MAX_URL_LENGTH`
- `ShopifyCheckoutLineItemSchema`
- `ShopifyCheckoutLineItemsSchema`
- `ShopifyCustomerReferenceSchema`
- `ShopifyMoneySchema`
- `ShopifyTenantSchema`

Type-only exports:

- `ShopifyCheckoutLineItem`
- `ShopifyCustomerReference`
- `ShopifyMoney`
- `ShopifyTenant`

From [src/shopify/constants.ts](src/shopify/constants.ts):

Runtime exports:

- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION`
- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V1`
- `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION_V2`
- `SHOPIFY_COMMERCE_EVENT_TYPES`
- `SHOPIFY_RECOVERY_EVENT_TYPES_V2`
- `SHOPIFY_WEBHOOK_OUTBOX_DESTINATIONS`

From [src/shopify/queue-contracts.ts](src/shopify/queue-contracts.ts):

Runtime exports:

- `parseShopifyDiscountSyncJob`
- `safeParseShopifyDiscountSyncJob`
- `SHOPIFY_DISCOUNT_SYNC_REASONS`
- `SHOPIFY_DISCOUNT_SYNC_WEBHOOK_TOPICS`
- `SHOPIFY_WEBHOOK_QUEUE_CONTRACTS`
- `ShopifyDiscountSyncJobSchema`
- `ShopifyDiscountSyncReasonSchema`
- `ShopifyDiscountSyncWebhookTopicSchema`

Type-only exports:

- `ShopifyDiscountSyncJob`

From [src/shopify/v1/checkout-observed.schema.ts](src/shopify/v1/checkout-observed.schema.ts):

Runtime exports:

- `CheckoutObservedPayloadSchema`

Type-only exports:

- `CheckoutObservedPayload`

From [src/shopify/v1/commerce-event.schema.ts](src/shopify/v1/commerce-event.schema.ts):

Runtime exports:

- `createShopifyCommerceOrderingKey`
- `createShopifyOrderOrderingKey`
- `isCheckoutObservedEvent`
- `isOrderCompletedEvent`
- `parseShopifyCommerceEvent`
- `safeParseShopifyCommerceEvent`
- `ShopifyCheckoutObservedEventSchema`
- `ShopifyCommerceEventSchema`
- `ShopifyOrderCompletedEventSchema`

Type-only exports:

- `ShopifyCheckoutObservedEvent`
- `ShopifyCommerceEvent`
- `ShopifyCommerceEventType`
- `ShopifyOrderCompletedEvent`

From [src/shopify/v1/order-completed.schema.ts](src/shopify/v1/order-completed.schema.ts):

Runtime exports:

- `OrderCompletedPayloadSchema`

Type-only exports:

- `OrderCompletedPayload`

From [src/shopify/v2/cart-activity.schema.ts](src/shopify/v2/cart-activity.schema.ts):

Runtime exports:

- `ShopifyCartActivityPayloadV2Schema`

Type-only exports:

- `ShopifyCartActivityPayloadV2`

From [src/shopify/v2/checkout-created.schema.ts](src/shopify/v2/checkout-created.schema.ts):

Runtime exports:

- `CheckoutCreatedPayloadV2Schema`

Type-only exports:

- `CheckoutCreatedPayloadV2`

From [src/shopify/v2/checkout-updated.schema.ts](src/shopify/v2/checkout-updated.schema.ts):

Runtime exports:

- `CheckoutUpdatedPayloadV2Schema`

Type-only exports:

- `CheckoutUpdatedPayloadV2`

From [src/shopify/v2/order-completed.schema.ts](src/shopify/v2/order-completed.schema.ts):

Runtime exports:

- `OrderCompletedPayloadV2Schema`

Type-only exports:

- `OrderCompletedPayloadV2`

From [src/shopify/v2/recovery-event.schema.ts](src/shopify/v2/recovery-event.schema.ts):

Runtime exports:

- `createShopifyCartActivityOrderingKey`
- `createShopifyOrderCorrelationOrderingKey`
- `createShopifyPendingRecoveryOrderingKey`
- `isCartActivityEventV2`
- `isCheckoutCreatedEventV2`
- `isCheckoutUpdatedEventV2`
- `isOrderCompletedEventV2`
- `parseShopifyRecoveryEventV2`
- `safeParseShopifyRecoveryEventV2`
- `ShopifyCartActivityEventV2Schema`
- `ShopifyCheckoutCreatedEventV2Schema`
- `ShopifyCheckoutUpdatedEventV2Schema`
- `ShopifyOrderCompletedEventV2Schema`
- `ShopifyRecoveryEventV2Schema`

Type-only exports:

- `ShopifyCartActivityEventV2`
- `ShopifyCheckoutCreatedEventV2`
- `ShopifyCheckoutUpdatedEventV2`
- `ShopifyOrderCompletedEventV2`
- `ShopifyRecoveryEventTypeV2`
- `ShopifyRecoveryEventV2`

</details>

<details>
<summary>/shopify/node — 5 exports</summary>

Import: `@modainteract/moda-interact-shared/shopify/node`.

From [src/shopify/node.ts](src/shopify/node.ts):

Runtime exports:

- `createPendingRecoveryCandidateJobId`
- `createShopifyCheckoutJobId`
- `createShopifyDiscountSyncJobId`
- `createShopifyOrderJobId`
- `createShopifyWebhookJobId`

</details>

<details>
<summary>/logging — 15 exports</summary>

Import: `@modainteract/moda-interact-shared/logging`.

From [src/logging/logger.ts](src/logging/logger.ts):

Runtime exports:

- `createLogger`

From [src/logging/redaction.ts](src/logging/redaction.ts):

Runtime exports:

- `CIRCULAR`
- `isSensitiveLogKey`
- `LOG_VALUE_LIMITS`
- `MAX_DEPTH_REACHED`
- `REDACTED`
- `sanitizeLogFields`
- `TRUNCATED`

From [src/logging/types.ts](src/logging/types.ts):

Runtime exports:

- `LOG_LEVELS`

Type-only exports:

- `LogFields`
- `LoggerOptions`
- `LogLevel`
- `LogRecord`
- `LogSink`
- `StructuredLogger`

</details>

<details>
<summary>/logging/node — 10 exports</summary>

Import: `@modainteract/moda-interact-shared/logging/node`.

From [src/logging/node.ts](src/logging/node.ts):

Runtime exports:

- `getNodeOpenTelemetryLoggingRuntime`
- `initNodeOpenTelemetryLogging`
- `parseOtlpHeaders`
- `resolveLogsEndpoint`

Type-only exports:

- `NodeOpenTelemetryLoggingOptions`
- `NodeOpenTelemetryLoggingRuntime`

From [src/logging/node/loki.ts](src/logging/node/loki.ts):

Runtime exports:

- `getNodeLokiLoggingRuntime`
- `initNodeLokiLogging`

Type-only exports:

- `NodeLokiLoggingOptions`
- `NodeLokiLoggingRuntime`

</details>

<details>
<summary>/observability — 4 exports</summary>

Import: `@modainteract/moda-interact-shared/observability`.

From [src/observability/index.ts](src/observability/index.ts):

Runtime exports:

- `getActiveTraceId`
- `withObservedSpan`

Type-only exports:

- `ObservedSpanOptions`
- `SpanExceptionMapper`

</details>

<details>
<summary>/observability/node — 7 exports</summary>

Import: `@modainteract/moda-interact-shared/observability/node`.

From [src/observability/node.ts](src/observability/node.ts):

Runtime exports:

- `getNodeObservabilityRuntime`
- `initNodeObservability`
- `resolveDeploymentEnvironmentName`
- `resolveSampler`

Type-only exports:

- `NodeInstrumentProfile`
- `NodeObservabilityOptions`
- `NodeObservabilityRuntime`

</details>

<details>
<summary>/observability/bullmq — 2 exports</summary>

Import: `@modainteract/moda-interact-shared/observability/bullmq`.

From [src/observability/bullmq.ts](src/observability/bullmq.ts):

Runtime exports:

- `createBullMQTelemetry`

Type-only exports:

- `BullMQTelemetryOptions`

</details>

<details>
<summary>/observability/genai — 7 exports</summary>

Import: `@modainteract/moda-interact-shared/observability/genai`.

From [src/observability/genai.ts](src/observability/genai.ts):

Runtime exports:

- `observeAgentInvocation`
- `observeAgentTool`
- `observeConversationTurn`

Type-only exports:

- `AgentObservation`
- `GenAIObservationOptions`

From [src/observability/index.ts](src/observability/index.ts):

Type-only exports:

- `ObservedSpanOptions`
- `SpanExceptionMapper`

</details>

<details>
<summary>/commerce — 97 exports</summary>

Import: `@modainteract/moda-interact-shared/commerce`.

From [src/commerce/canonical-json.ts](src/commerce/canonical-json.ts):

Runtime exports:

- `canonicalJson`
- `jsonBytes`
- `responseContractCanonicalJson`

Type-only exports:

- `Digest`

From [src/commerce/definitions.ts](src/commerce/definitions.ts):

Runtime exports:

- `capabilityHashInput`
- `CommerceExecutionSchema`
- `CommerceToolDefinitionSchema`
- `CommerceToolDraftDefinitionSchema`
- `CommerceToolIdentitySchema`
- `CommerceToolRevisionIdentitySchema`
- `definitionToMcpDescriptor`
- `GrantedToolSchema`
- `GrantedToolsSchema`
- `mapToolArguments`
- `POLICY_OPERATION_DESCRIPTORS`
- `POLICY_OPERATIONS`
- `ResponseTemplateSchema`
- `ToolBindingSchema`
- `ToolBindingsSchema`
- `ToolDescriptorSchema`
- `toolHashInput`
- `ToolNameSchema`
- `validateDefinitionForPublication`
- `validateDefinitionVersion`

Type-only exports:

- `CommerceDefinitionCompiler`
- `CommerceToolDefinition`
- `CommerceToolDraftDefinition`
- `GrantedTool`
- `ToolDescriptor`

From [src/commerce/fixtures.ts](src/commerce/fixtures.ts):

Runtime exports:

- `exampleDefinition`
- `exampleFinal`
- `exampleGrant`
- `exampleManifest`
- `exampleTool`
- `exampleTurn`

From [src/commerce/primitives.ts](src/commerce/primitives.ts):

Runtime exports:

- `boundedJson`
- `ContractVersionSchema`
- `CurrencySchema`
- `DateSchema`
- `distinct`
- `HashSchema`
- `IdSchema`
- `LanguageSchema`
- `MoneySchema`
- `SemverSchema`

From [src/commerce/response.ts](src/commerce/response.ts):

Runtime exports:

- `CommerceFinalResponseSchema`
- `CommerceResponseContractSchema`
- `EMPTY_RESPONSE_CONTRACT`
- `finalResponseSchema`
- `finalResponseToolSchema`
- `ReferralReasonSchema`
- `verifyResponseContract`

Type-only exports:

- `CommerceFinalResponse`
- `CommerceResponseContract`

From [src/commerce/schemas.ts](src/commerce/schemas.ts):

Runtime exports:

- `CommerceAlternativeSchema`
- `CommerceAssertionSchema`
- `CommerceBasketSchema`
- `CommerceConfigurationSchema`
- `CommerceConversationGrantSchema`
- `CommerceErrorCodeSchema`
- `CommerceEvidenceSchema`
- `CommerceExecuteAssertionSchema`
- `CommerceManifestSchema`
- `CommerceOfferSchema`
- `CommerceProductSchema`
- `CommerceProposalSchema`
- `CommerceReleaseIdentitySchema`
- `CommerceResolveAssertionSchema`
- `CommerceToolInputs`
- `CommerceToolOutputs`
- `commerceToolResultSchema`
- `CommerceToolResultSchema`
- `CommerceTurnIdentitySchema`
- `productBelongsToDomain`

Type-only exports:

- `CommerceConversationGrant`
- `CommerceEvidence`
- `CommerceManifest`
- `CommerceToolResult`
- `CommerceTurnIdentity`

From [src/commerce/selection.ts](src/commerce/selection.ts):

Runtime exports:

- `CommerceCapabilityBindingSchema`
- `currentlyGrantedTools`
- `deduplicateTools`
- `manifestMatchesGrant`
- `parseCommerceManifest`
- `selectCapabilities`

Type-only exports:

- `CommerceCapabilityBinding`
- `FeatureFacts`

From [src/commerce/subset.ts](src/commerce/subset.ts):

Runtime exports:

- `compileSubset`
- `DetailsSchemaSchema`
- `InputSchemaSchema`
- `matchesSubset`
- `MONEY_PATTERN`
- `safeName`
- `safePath`
- `validateSubset`

Type-only exports:

- `Json`
- `SubsetSchema`

</details>

<details>
<summary>/commerce/runner — 10 exports</summary>

Import: `@modainteract/moda-interact-shared/commerce/runner`.

From [src/commerce/runner/index.ts](src/commerce/runner/index.ts):

Runtime exports:

- `PLATFORM_INSTRUCTIONS`
- `runCommerceTurn`
- `runnerVersion`

Type-only exports:

- `ModelCall`
- `ModelRequest`
- `ModelStep`
- `RunCommerceTurnInput`
- `RunCommerceTurnResult`
- `RunnerErrorCode`
- `RunnerTool`

</details>
