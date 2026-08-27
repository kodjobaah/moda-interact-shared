# @modainteract/moda-interact-shared

Shared, runtime-validated TypeScript contracts used by more than one Moda
Interact service. This package is a library, not a service: it has no
transport, persistence, or framework code of its own.

## What this package owns

- Zod schemas for cross-service event contracts (currently: Shopify commerce
  events).
- TypeScript types inferred from those schemas (`z.infer`), so producers and
  consumers share one source of truth.
- Constants (queue/job names, schema version, event type strings).
- Parsing helpers and small pure utilities (ordering-key and job-id
  derivation) needed to construct or validate those contracts.

This package does **not** define Prisma models, own migrations, or implement
any queue/transport client. PostgreSQL and Redis store the *serialized*
event envelope as JSON; the database layer does not enforce or duplicate its
shape. Producers must construct and validate an event with the schemas in
this package before persisting it. Consumers must parse the JSON read back
from PostgreSQL/Redis with the same schemas before acting on it — never trust
it as pre-validated.

## Ownership boundary

- **moda-interact** — authenticates Shopify webhooks, normalizes payloads,
  constructs and validates a `ShopifyCommerceEvent`, and writes it to the
  transactional outbox.
- **moda-interact-background** — parses `ShopifyCommerceEvent` (via
  `parseShopifyCommerceEvent` / `safeParseShopifyCommerceEvent`) before
  processing, dispatches by `eventType`, and applies tenant-safe, idempotent
  domain transitions.
- **moda-interact-database** — stores receipt metadata and outbox JSON. It
  does not own or duplicate the TypeScript event types defined here.

## Schema versioning

`schemaVersion` is embedded in every serialized event and is currently `1`.

- Any breaking change to the serialized shape (removing/renaming a field,
  changing a type, tightening validation in a way that rejects previously
  valid data) requires bumping `SHOPIFY_COMMERCE_EVENT_SCHEMA_VERSION` and
  updating the schema to branch on it.
- Additive, optional-field changes do not require a version bump, but must
  still be reviewed for old-consumer safety (an older consumer parsing a
  newer envelope must not fail just because of a new optional field).

## Exports

- `@modainteract/moda-interact-shared` — re-exports everything from
  `./shopify`.
- `@modainteract/moda-interact-shared/shopify` — schemas, types, constants,
  and the pure `createShopifyCommerceOrderingKey` helper. Safe for browser
  bundles (no Node built-ins).
- `@modainteract/moda-interact-shared/shopify/node` — `createShopifyWebhookJobId`,
  which uses `node:crypto` and is therefore isolated in a Node-only subpath so
  it isn't accidentally pulled into browser bundles that import the root or
  `./shopify` entry points.

## Building and testing

```sh
npm run typecheck
npm run build
npm test
```
