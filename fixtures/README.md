# ARCH-045 identity interoperability vectors

`identity-v1.json` is a plain, runtime-neutral JSON fixture published at
`@modainteract/moda-interact-shared/identity/fixtures`. JavaScript, TypeScript
and WooCommerce PHP consumers must use the **same records** to test their
respective adapters. PHP does not import any Node implementation source.

- `phoneCases`: with a verified ISO country context (or `null` for explicit
  international-format input), compare the canonical E.164 result or the
  typed rejection. These are numbering-plan checks, never consent grants.
- `shopifyCustomerCases` and `rejectedShopifyCustomerCases`: compare the exact
  canonical decimal string/GID or typed rejection. A JSON `number` is only
  safe when representable as a JavaScript safe integer.
- `shopifyScopeCases`: numeric/GID equality is valid only **within** the same
  authenticated shop; this test alone is not authorisation.
- `recipientLifecycleCases`: reformatting equivalence does not carry grants
  between customers, shops, or an old/new number. Phone reuse must not merge
  principals, even when canonical phone strings match.

The Shared fixtures establish expected behaviour; WooCommerce adapter parity
must be exercised in the owning WooCommerce/API tasks against this JSON rather
than reimplementing JavaScript code or assuming a PHP codec already exists.

The UK success vectors use a number in a valid GB mobile numbering range.
`07700 900000–900999` is reserved for fictional use and rejected by the
strict numbering-plan validator; `gb-reserved-fictional` explicitly covers
that case. Every fixture is for offline parsing/comparison **only** and must
never be dialled or messaged.

# ARCH-047 Meta template-status event v2 interoperability vectors

`meta-template-status-v2.json` is a pure JSON fixture available at
`@modainteract/moda-interact-shared/whatsapp-template-events/fixtures`.
It contains the exact canonical observation, expected BullMQ job ID, and
additional distinct occurrence UUID v4 vectors for identical provider values,
APPROVED → PAUSED → APPROVED, and separate identical webhook deliveries.
A producer assigns new occurrence IDs only after signed whole-batch preflight.
A retry of an already-enqueued job retains its existing job ID. The fixture
asserts wire compatibility and uniqueness—not provider status ordering or
permission to contact a customer.
