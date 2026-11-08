# Initial checkout outreach

This server-side public subpath contains the read-only ARCH-066 evaluator and frozen initial-template renderer. `evaluateInitialOutreachPreview` is the same function as `evaluateInitialOutreach`. Hosts authenticate calls and provide the clock, cancellation and admitted execution limits. They retain final send fences, recovery fingerprints, attempt IDs, approved same-shop URLs, WABA admission, saved registration freshness checks and all writes/delivery.

Source relocation reference: Background `d7e78bdb5e75248b9a15e2c84d07dcdc89027c19`:

- `commerce/recommendations/{eligibility,combinations,money}`: eligibility, combination and decimal arithmetic retained locally, without service imports.
- `agents/initial-outreach-offer.{types,graph,instructions}`: strict result/choice schemas, authority instructions and bounded selection state loop. The checkout-only contract removes alternative-product search/promotion; injected ports replace MCP/model service resolution. Nested price/eligibility/group data has real validation.
- `services/recovery-pricing/price-comparison`: ordered canonical SHA256 basket content and decimal comparison, excluding host attempt/recovery identity. Historical price and live merchandise subtotal remain distinct; no assertion of payable checkout repricing.
- `services/recovery-template-preparation/{recovery-template-selection,recovery-template-bindings,initial-checkout-items-policy,recovery-template-items-summary,recovery-template-brand}`: existing selection, frozen projection digest/token/slot checks, item summary and bounded variable rules. Binding evaluation is synchronous over prepared values/media, with no database/media callbacks. Missing brand-only fields remain unavailable rather than invented.

Frozen projection dates are serialized UTC strings. `preparedProjection` preserves the selected variant/registration field names, language and selection source; an optional host-prepared `textFallback` projection is subject to the same selection, status, locale and hash checks. A missing assignment is null. `headerMedia` contains only a host-authorized READY R2 derivative. No network request or derivative generation occurs in the renderer. Rendered text includes the frozen text header, substituted body and footer; the substituted body is checked independently against 4096 UTF16 units. Provider parameters preserve the original frozen order.

Every tool attempt and model invocation consumes the shared remote-call allowance; reused duplicate product observations consume none. Ready NONE reads every distinct product pair twice in first-occurrence order, retaining every original line quantity/order. Current fact comparison excludes observation timestamps alone; changed identity, availability, prices, membership or descriptive facts cannot silently replace earlier evidence. Selected discounts are reread and re-evaluated before ready. Port failures never expose provider bodies. No automatic retries occur.

Public artifact gate: build, then `npm run validate:commerce-outreach`; it packs locally, installs that tarball in a temporary project and checks public JavaScript and declaration imports. This task does not publish the package. SHARED-005 owns the immutable combined release.

## Prepared saved brand and ready media

Optional `preparedBrand` is null/omitted or the exact strict object
`{shopId,brandName,logoAltText,logoWidth,logoHeight,squareLogoAltText}`. Every field
is required when supplied; unavailable values are null. Text values have a
200 JavaScript UTF16-unit pre-trim schema cap. Bound text passes existing
boundedText rules (nonblank, no forbidden controls/unpaired surrogate or template
braces) and emits trimmed text. Dimensions are integers 1–10000 inclusive, never
coerced from text; null bound dimensions refuse. Missing mandatory saved brandName
never uses generic variables.shopName. Ordinary shop.name remains unchanged.

Optional `preparedBrandMedia` is null/omitted or strict
`{logo,squareLogo,coverImage}` with every slot required and nullable. Each nonnull
item uses public PreparedOutreachBrandMediaItemSchema: existing strict
`{shopId,role,status:'READY',kind:'R2_DERIVATIVE',httpsUrl}`. URL limit is2048,
HTTPS without credentials; brand entries additionally reject fragments and
undotted hostnames. Slots must match LOGO/SQUARE_LOGO/COVER_IMAGE respectively and
evaluation.shopId, even when unused. Shared never infers R2 ownership from a
hostname and never fetches/generates media. The trusted host authorizes saved
same-shop ready derivatives using its configured media owner. Original/raw image
URLs and status/kind alternatives are unavailable, never fallback evidence.

BODY logoUrl/squareLogoUrl/coverImageUrl use only those fixed slots and emit exact
validated URL bytes. All three work in TEXT-only bodies, independently of
headerMedia. Existing IMAGE header (including CHECKOUT_PRODUCT) still uses only
headerMedia; missing header uses only an approved textFallback. A BODY slot never
borrows header media and preparedBrandMedia never synthesizes an IMAGE header.

Complete structural parse failures return INVALID_REQUEST without leaking input
or throwing on malformed URLs. Then preparedBrand tenant mismatch returns
IDENTITY_MISMATCH, then any supplied brand-media tenant/role/fragment/hostname
conflict returns MEDIA_NOT_READY, before assignment/fallback/hash checks. Bound
missing text/dimensions return BINDING_VALUE_UNAVAILABLE; bound missing media
returns MEDIA_NOT_READY. SchemaVersion1, parameter order, frozen hashes/provenance,
encoded checkout buttons, existing result bounds and substituted BODY4096 limit
remain unchanged.

Consumer handoff: BACKGROUND-002/COMMERCE-002 populate preparedBrand from existing
same-shop saved brand columns (missing columns null), and ready authorized
R2 derivatives into fixed role slots. Existing IMAGE header stays headerMedia.
No raw brand record, callback, generic-name mandatory fallback, consent/credit/send
change or database operation belongs here. Old no-brand inputs retain exact bytes;
old brand-bound inputs without projections deliberately refuse instead of using
generic shopName/headerMedia. Consumers adopt only accepted immutable SHARED-012;
publication/adoption/deployment remain separate. Background's remaining72 failing
checks require same-task investigation/revalidation; Shared goldens do not waive
them.
