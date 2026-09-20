# Commerce contracts and runner

Public entry points are `@modainteract/moda-interact-shared/commerce` and
`@modainteract/moda-interact-shared/commerce/runner`. They are provider-neutral.
Existing WhatsApp, billing and recovery-policy exports are unchanged.

The contract version is `commerce.v1`; the runner API version is `1.0.0`.
Package SemVer is separate. A host must satisfy the pinned manifest's SemVer
runnerCompatibility range. Unknown wire versions or missing/mismatched
response.v1 definitions fail closed. Never substitute the active release for an
existing grant.

## Authority and publication

Zod proves shape and local consistency, not database ownership. Adapters must
prove tenant/recovery/conversation ownership, current processing lease, released
revision identity, and current policy. Assertions here describe purpose-bound
turn data; the Commerce/Background owners supply JWT signing and verification.

`CommerceToolDraftDefinitionSchema` accepts bounded incomplete objects for editing.
`CommerceToolDefinitionSchema` checks the strict structural definition and mappings.
**Publication also requires `validateDefinitionForPublication` with the authoritative
CommerceDefinitionCompiler.** That compiler validates the fixed GraphQL document
against the retained official schema, operation/root restrictions, depth/cost/list
bounds and variable types, or the versioned policy operation contract. It derives
the output schema and verifies all mappings. Shared does not ship Shopify schema
artifacts, spawn a provider process, or pretend that structural parsing proves a
query can execute. Template token paths are checked against the compiler output.

Definitions are not downloaded executable handlers. The model sees only descriptors,
never execution configuration or arbitrary runtime GraphQL input. A new tool name
needs no runner branch. Exact shared revisions deduplicate with sorted original
capability provenance; conflicts reject. Current authorization can restrict or
restore only original entries, never enlarge them.

C4 hashes use `canonicalJson` (Unicode code-point key order). C16 specifically
requires RFC8785: use `responseContractCanonicalJson` (UTF-16 key order). Both
reject undefined/nonfinite/cyclic/non-JSON values and invalid Unicode. Server
adapters inject SHA-256 via `Digest`; there is no hashing provider or Node-only
crypto import in the contract entry point. Capability and tool hash-input helpers
select the exact canonical fields. Schema-backed basket/rule adapters must include
all semantic fields/currency and exclude observation timestamps before hashing.

## Runner adapter contract

`runCommerceTurn` receives validated original turn/grant/manifest, pinned prompts,
trusted host instructions/context, bounded history, language metadata, AbortSignal,
clock, digest and injected model/tool adapters. Model output is `{calls,outputTokens}`;
report the actual provider output-token count. The model receives maxOutputTokens
and the runner checks the reported count. Adapters must honor cancellation, propagate
signals to provider I/O and must not hide retries. Late results cannot complete a turn.

Each tool adapter supplies the exact manifest descriptor, a fresh `isAuthorized`
check and read-only execution. Only reviewed policy adapters may supply
`extractEvidence`: extract actual structured discount evidence from the returned
data, never from renderedText. Public Storefront fact payloads are never registered
as evidence. Extracted evidence must match the current turn/grant/release and its
canonical hash; final references must be fresh registered qualifying evidence.
The runner reserves one remaining remote call per final evidence reference.
Background owns actual pre-delivery revalidation and must include those reserved
calls in the same ten-call budget. A recomputed hash alone grants no authority.

The runner passes platform instructions first, then host recovery instructions,
then pinned response guidance, then pinned capability prompts in membership order.
Context/history/tool results remain separate data. Host recovery-state and fallback
language policy remain in Background. Explicit language preferences mechanically
require null detection metadata; other natural-language grounding/language choices
remain model instructions plus host validation, not universal hallucination detection.

Unknown/unavailable/ungranted facts should produce the typed referral. A denied or
failed tool cannot be followed by a successful ANSWER envelope in this runner.
The host renders trusted referral contacts and ignores custom `details` for delivery,
routing, billing, language and evidence. No extra message or handoff is generated.

## Validation evidence

`contracts.test.ts` and `runner/runner.test.ts` include C14 identity/schema/mapping/
compiler cases, all six baseline policy operation fixtures, selection matrices,
C16 R01–R05/R08/R11/R12 and C6.1 P01–P12 structural scenarios. The scripted model
asserts exact side-effect counts, ordering, fixed grant restrictions and deadlines.
`runner/adversarial-evaluations.json` records natural-language evaluation cases;
scripted outputs do not prove a live model never fabricates facts, regions or policy.

After building, `npm run validate:commerce-entrypoints` imports both exports in a
fresh process with provider/database environment absent and runs schema/final-output
smoke checks. The same script can target a clean registry consumer by setting
COMMERCE_CONSUMER_DIRECTORY to that temporary installation directory.
