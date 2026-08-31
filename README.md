# @modainteract/moda-interact-shared

Shared TypeScript contracts and reusable platform primitives used by multiple
Moda Interact services.

This package is a **library**, not a deployable service. It does not own
transport, persistence, background workers, provider SDK integration, or
application business workflows.

## Install

```bash
npm install @modainteract/moda-interact-shared
```

Production services should use the exact package version selected by the
corresponding Moda Interact architecture/release task rather than relying on a
floating version.

## What this package owns

The package contains code that genuinely belongs at a cross-service boundary,
including:

- runtime-validated cross-service event contracts;
- TypeScript types shared by producers and consumers;
- schema and event-version constants;
- canonical queue/job-name constants where multiple repositories must agree;
- deterministic correlation/job identifier helpers;
- small pure utilities used by more than one service;
- reusable structured application logging primitives.

The package deliberately keeps framework and runtime dependencies small.

## What this package does not own

This package does **not** own:

- Prisma models or database migrations;
- PostgreSQL persistence;
- BullMQ/Redis clients or worker processes;
- Shopify or Meta webhook HTTP handlers;
- Shopify or Meta SDK integration;
- application recovery/business logic;
- OpenTelemetry spans or application-specific metrics;
- OpenTelemetry tracing/metrics SDK bootstraps;
- deployment OTLP endpoint/credential wiring or observability backends;
- Render deployment configuration.

Those capabilities remain in the repository that owns the corresponding
runtime concern.

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

### Tracing/metrics remain service-specific

The shared logger does **not** create spans, counters or histograms.

Service-specific OpenTelemetry tracing and metrics remain in the owning runtime
repository, for example:

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
- owns Shopify-specific observability semantics and OpenTelemetry.

**moda-interact-background**

- parses shared cross-service contracts before acting;
- runs BullMQ workers and recovery workflows;
- uses the shared logger for generic structured logging;
- owns worker/recovery OpenTelemetry.

**moda-interact-messaging**

- owns Meta/WhatsApp ingress;
- uses the shared logger for generic structured logging;
- owns Meta/WhatsApp-specific observability and OpenTelemetry.

**moda-interact-admin**

- owns the internal admin application;
- may use the same shared logger where server-side operational logging is
  required;
- owns admin-specific application telemetry.

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
