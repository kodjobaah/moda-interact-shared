import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateInitialOutreach } from './evaluate.js';
import { renderInitialOutreachPreview } from './render.js';
import { InitialOutreachRenderInputSchema, InitialOutreachRenderResultSchema } from './template-contracts.js';
import { fixture, ports, renderFixture, stable } from './test-fixtures.js';
async function input() {
    const r = await evaluateInitialOutreach(fixture(), ports().value);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        throw new Error('not ready');
    return renderFixture(r);
}
function rehash(i: Awaited<ReturnType<typeof input>>) { const r = i.preparedProjection!.variant.metaRegistration!; const h = createHash('sha256').update(stable({ schemaVersion: 1, family: 'META_RECOVERY', category: 'MARKETING', components: r.componentsSnapshot, parameterBindings: r.parameterBindingsSnapshot })).digest('hex'); r.submittedContentHash = h; r.lastObservedContentHash = h; r.locale.contentHash = h; }
test('frozen provider parameter/body/button/provenance golden', async () => {
    const i = await input();
    const r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        return;
    assert.deepEqual(r.parameters, [{ type: 'body', parameters: [{ type: 'text', text: 'Test customer' }, { type: 'text', text: 'Merchant' }, { type: 'text', text: '2 × Custom label' }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'https%3A%2F%2Fshop.example%2Fcheckout%2F1' }] }]);
    assert.equal(r.renderedText, 'Hello Test customer from Merchant: 2 × Custom label');
    assert.equal(r.templateProvenance.registrationId, 'registration-1');
    assert.equal(r.templateProvenance.submittedContentHash, r.templateProvenance.bindingFingerprint);
    assert.equal(r.headerPreview, null);
    assert.ok(InitialOutreachRenderResultSchema.safeParse(r).success);
});
test('approved TEXT fallback when IMAGE has no READY media', async () => {
    const i = await input(), fallback = structuredClone(i.preparedProjection!);
    const r = i.preparedProjection!.variant.metaRegistration!;
    r.componentsSnapshot.unshift({ type: 'HEADER', format: 'IMAGE' });
    r.parameterBindingsSnapshot.schemaVersion = 1;
    r.parameterBindingsSnapshot.headerMediaRole = 'CHECKOUT_PRODUCT';
    rehash(i);
    assert.equal(renderInitialOutreachPreview(i).kind === 'refused' && (renderInitialOutreachPreview(i) as any).reasonCode, 'MEDIA_NOT_READY');
    i.preparedProjection!.textFallback = fallback;
    const text = renderInitialOutreachPreview(i);
    assert.equal(text.kind, 'ready');
    if (text.kind === 'ready')
        assert.equal(text.headerPreview, null);
    i.headerMedia = { shopId: 'shop-1', role: 'CHECKOUT_PRODUCT', status: 'READY', kind: 'R2_DERIVATIVE', httpsUrl: 'https://assets.example/ready.webp' };
    const image = renderInitialOutreachPreview(i);
    assert.equal(image.kind, 'ready');
    if (image.kind === 'ready')
        assert.deepEqual(image.parameters[0], { type: 'header', parameters: [{ type: 'image', image: { link: i.headerMedia.httpsUrl } }] });
});
for (const [expected, mutate] of [
    ['NO_APPROVED_ASSIGNMENT', (i: any) => { i.preparedProjection = null; }],
    ['IDENTITY_MISMATCH', (i: any) => { i.preparedProjection.variant.shopId = 'foreign'; }],
    ['LOCALE_UNAVAILABLE', (i: any) => { i.preparedProjection.variant.metaRegistration.locale.status = 'DRAFT'; }],
    ['PROVIDER_UNAVAILABLE', (i: any) => { i.preparedProjection.variant.metaRegistration.providerStatus = 'PAUSED'; }],
    ['BINDING_FINGERPRINT_MISMATCH', (i: any) => { i.preparedProjection.variant.metaRegistration.submittedContentHash = 'a'.repeat(64); i.preparedProjection.variant.metaRegistration.lastObservedContentHash = null; }],
    ['BINDING_VALUE_UNAVAILABLE', (i: any) => { i.variables.customerFirstName = 'bad\u0000'; }],
    ['INVALID_REQUEST', (i: any) => { i.preparedProjection.variant.metaRegistration.componentsSnapshot[0].extra = true; }],
] as const)
    test(`render refuses ${expected}`, async () => { const i = await input(); mutate(i); const r = renderInitialOutreachPreview(i); assert.equal(r.kind === 'refused' && r.reasonCode, expected); });
test('literal escapes/Unicode remain inert, controls/braces fail closed', async () => {
    const i = await input();
    i.variables.customerFirstName = 'Alex & <guest> 🪴';
    let r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready')
        assert.ok(r.renderedText.includes('Alex & <guest> 🪴'));
    for (const name of ['{{1}}', 'bad\ntext', '\ud800']) {
        i.variables.customerFirstName = name;
        r = renderInitialOutreachPreview(i);
        assert.equal(r.kind === 'refused' && r.reasonCode, 'BINDING_VALUE_UNAVAILABLE');
    }
});
test('4096 UTF16 body boundary refuses without truncating parameters', async () => {
    const i = await input(), r = i.preparedProjection!.variant.metaRegistration!;
    r.parameterBindingsSnapshot.body.push({ position: 4, variable: 'checkout.url' }, { position: 5, variable: 'checkout.url' });
    const body = r.componentsSnapshot[0]!;
    assert.ok('text' in body);
    if (!('text' in body))
        return;
    body.text = '{{1}}{{2}}{{3}}{{4}}{{5}}';
    i.variables.checkoutUrl = 'https://shop.example/' + 'x'.repeat(2027);
    rehash(i);
    const result = renderInitialOutreachPreview(i);
    assert.equal(result.kind === 'refused' && result.reasonCode, 'MESSAGE_TOO_LARGE');
    assert.ok(InitialOutreachRenderInputSchema.safeParse(i).success);
});
test('exact 4096 UTF16 body admitted; 4097 refused; header and footer preview text retained', async () => {
    const i = await input(), registration = i.preparedProjection!.variant.metaRegistration!;
    registration.parameterBindingsSnapshot.body.push({ position: 4, variable: 'checkout.url' }, { position: 5, variable: 'checkout.url' });
    const body = registration.componentsSnapshot[0]!;
    if (!('text' in body))
        throw new Error('body');
    i.variables.checkoutUrl = 'https://shop.example/' + 'x'.repeat(2000);
    const length = 'Test customer'.length + 'Merchant'.length + '2 × Custom label'.length + 2 * i.variables.checkoutUrl.length;
    body.text = 'a'.repeat(4096 - length) + '{{1}}{{2}}{{3}}{{4}}{{5}}';
    rehash(i);
    let r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready')
        assert.equal(r.renderedText.length, 4096);
    body.text += 'x';
    rehash(i);
    r = renderInitialOutreachPreview(i);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'MESSAGE_TOO_LARGE');
    const j = await input(), reg = j.preparedProjection!.variant.metaRegistration!;
    reg.componentsSnapshot.unshift({ type: 'HEADER', format: 'TEXT', text: 'Welcome {{1}}' });
    reg.parameterBindingsSnapshot.header = [{ position: 1, variable: 'customer.firstName' }];
    reg.componentsSnapshot.splice(2, 0, { type: 'FOOTER', text: 'Footer' });
    rehash(j);
    r = renderInitialOutreachPreview(j);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready') {
        assert.equal(r.renderedText, 'Welcome Test customer\nHello Test customer from Merchant: 2 × Custom label\nFooter');
        assert.deepEqual(r.parameters[0], { type: 'header', parameters: [{ type: 'text', text: 'Test customer' }] });
    }
});
