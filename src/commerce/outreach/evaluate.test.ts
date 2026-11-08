import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInitialOutreach, evaluateInitialOutreachPreview } from './evaluate.js';
import { InitialOutreachEvaluationInputSchema, InitialOutreachEvaluationResultSchema } from './contracts.js';
import { fixture, product, ports, at } from './test-fixtures.js';
import { fingerprintInitialOutreachBasket } from './reconcile.js';
test('NONE exact sequential two-pass reads, duplicate reuse and original quantities/order', async () => {
    const i = fixture();
    i.checkout.lines.push({ ...i.checkout.lines[0]!, lineKey: 'duplicate', quantity: 3 }, { ...i.checkout.lines[0]!, lineKey: 'second', productId: 'gid://shopify/Product/2' });
    const p = ports(i);
    const r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        return;
    assert.deepEqual(p.calls.map(c => c.arguments), [i.checkout.lines[0], i.checkout.lines[2], i.checkout.lines[0], i.checkout.lines[2]].map(l => ({ productId: l!.productId, variantId: null })));
    assert.ok(p.calls.every(c => c.signal === p.value.signal && c.shopId === i.shopId));
    assert.equal(p.modelCalls, 0);
    assert.deepEqual(r.lines.map(l => [l.lineKey, l.quantity, l.checkoutUnitPrice, l.currentProduct.unitPrice, l.comparison]), [['line-1', 2, '10.00', '12.00', 'DIFFERENT'], ['duplicate', 3, '10.00', '12.00', 'DIFFERENT'], ['second', 2, '10.00', '12.00', 'DIFFERENT']]);
    assert.deepEqual(r.currentMerchandiseSubtotal, { amountDecimal: '84.00', currency: 'USD' });
    assert.equal(r.offerDecision.kind, 'NO_VERIFIED_OFFER');
    assert.equal(r.toolActivity.length, 4);
    assert.ok(InitialOutreachEvaluationResultSchema.safeParse(r).success);
    assert.equal(evaluateInitialOutreachPreview, evaluateInitialOutreach);
});
for (const platform of ['SHOPIFY', 'WOOCOMMERCE'] as const)
    for (const title of ['Blue clothing', 'Nail varnish 15 ml', 'Tree 2 m', 'My custom label 🪴'])
        test(`${platform}: generic facts ${title}`, async () => {
            const i = fixture(platform);
            const p = ports(i, () => ({ product: product(i, { title, attributes: { status: 'AVAILABLE', items: [{ name: 'Merchant unit', values: ['15 ml'] }] } }) }));
            const r = await evaluateInitialOutreach(i, p.value);
            assert.equal(r.kind, 'ready');
            if (r.kind === 'ready')
                assert.equal(r.lines[0]!.currentProduct.title, title);
        });
for (const [reason, override] of [
    ['PRODUCT_NOT_FOUND', null], ['PRODUCT_UNAVAILABLE', { available: false }], ['IDENTITY_MISMATCH', { productId: 'gid://shopify/Product/2' }], ['CURRENCY_MISMATCH', { currency: 'EUR' }], ['PRICE_UNAVAILABLE', { unitPrice: null }], ['ARITHMETIC_UNSAFE', { unitPrice: '999999999999999999' }], ['INVALID_RESULT', { observedAt: '2026-11-08T16:59:59.000Z' }],
] as const)
    test(`refuses ${reason}`, async () => {
        const i = fixture();
        const p = ports(i, () => ({ product: override === null ? null : product(i, override) }));
        const r = await evaluateInitialOutreach(i, p.value);
        assert.equal(r.kind, 'refused');
        if (r.kind === 'refused')
            assert.equal(r.reasonCode, reason);
    });
test('revalidation refuses changed current facts without retry', async () => {
    const i = fixture(), p = ports(i, (_, n) => ({ product: product(i, { unitPrice: n === 1 ? '12.00' : '13.00' }) }));
    const r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind, 'refused');
    if (r.kind === 'refused')
        assert.equal(r.reasonCode, 'CURRENT_FACTS_CHANGED');
    assert.equal(p.calls.length, 2);
});
for (const code of ['DENIED', 'UNAVAILABLE', 'CANCELLED', 'DEADLINE', 'BUDGET_EXHAUSTED'] as const)
    test(`typed port failure ${code}`, async () => {
        const i = fixture(), p = ports(i, () => { throw Object.assign(new Error('secret raw body'), { code }); });
        const r = await evaluateInitialOutreach(i, p.value);
        assert.equal(r.kind, 'refused');
        if (r.kind === 'refused')
            assert.equal(r.reasonCode, code === 'UNAVAILABLE' ? 'PROVIDER_UNAVAILABLE' : code);
        assert.ok(!JSON.stringify(r).includes('secret'));
    });
test('budget, cancellation, real deadline and late completion cannot return ready', async () => {
    const i = fixture();
    i.limits.remoteCalls = 1;
    let p = ports(i);
    let r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'BUDGET_EXHAUSTED');
    assert.equal(p.calls.length, 1);
    p = ports();
    p.controller.abort();
    r = await evaluateInitialOutreach(fixture(), p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'CANCELLED');
    assert.equal(p.calls.length, 0);
    const slow = fixture();
    slow.limits.deadlineMs = 5;
    p = ports(slow);
    p.value.callTool = () => new Promise(() => { });
    r = await evaluateInitialOutreach(slow, p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'DEADLINE');
});
test('strict malformed/oversize input rejected before I/O and fingerprint excludes host IDs', async () => {
    for (const mutate of [(i: any) => { i.checkout.lines[0].quantity = 0; }, (i: any) => { i.checkout.lines[0].productId = 'fake'; }, (i: any) => { i.checkout.extra = 'x'; }, (i: any) => { i.instructions.merchantRevisionId = 'missing'; }, (i: any) => { i.policy.authorisedDiscountIds = ['1']; }, (i: any) => { i.checkout.url = 'https://user:password@shop.example'; }, (i: any) => { i.extra = 'x'.repeat(131073); }]) {
        const i = fixture();
        mutate(i);
        const p = ports();
        const r = await evaluateInitialOutreach(i, p.value);
        assert.equal(r.kind === 'refused' && r.reasonCode, 'INPUT_INVALID');
        assert.equal(p.calls.length, 0);
    }
    const i = fixture(), j = fixture();
    j.runId = 'another-run';
    j.shopId = 'another-shop';
    j.checkout.id = 'another-checkout';
    j.checkout.generation = 2;
    assert.equal(fingerprintInitialOutreachBasket(i), fingerprintInitialOutreachBasket(j));
    assert.ok(InitialOutreachEvaluationInputSchema.safeParse(i).success);
});
test('malformed product and foreign tenant envelope rejected', async () => {
    for (const value of [{ product: { unitPrice: 'bad' } }, { product: product(), shopId: 'foreign' }]) {
        const p = ports(fixture(), () => value), r = await evaluateInitialOutreach(fixture(), p.value);
        assert.equal(r.kind === 'refused' && r.reasonCode, 'INVALID_RESULT');
    }
});
test('bounded result overflow refuses RESULT_TOO_LARGE after exact deduplicated reads', async () => {
    const i = fixture();
    i.checkout.lines = Array.from({ length: 100 }, (_, n) => ({ ...i.checkout.lines[0]!, lineKey: 'line-' + n }));
    const p = ports(i, () => ({ product: product(i, { description: { status: 'AVAILABLE', text: 'd'.repeat(4096) }, attributes: { status: 'AVAILABLE', items: [{ name: 'Attribute', values: Array.from({ length: 12 }, (_, n) => String(n) + 'v'.repeat(120)) }] } }) }));
    const r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'RESULT_TOO_LARGE');
    assert.equal(p.calls.length, 2);
});
test('cancellation during pending read wins and changed availability refuses final facts', async () => {
    const i = fixture(), p = ports(i);
    p.value.callTool = () => new Promise(resolve => setTimeout(() => resolve({ product: product(i) }), 20));
    setTimeout(() => p.controller.abort(), 1);
    let r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'CANCELLED');
    const changed = ports(i, (_, n) => ({ product: product(i, { available: n === 1 }) }));
    r = await evaluateInitialOutreach(i, changed.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'CURRENT_FACTS_CHANGED');
});
test('fresh observation timestamps alone do not change product facts; revocation at final fence refuses',async()=>{
 const i=fixture(),p=ports(i,(_,n)=>({product:product(i,{observedAt:n===1?at:'2026-11-08T17:00:00.001Z',saleEvidence:{regularPrice:'13.00',salePrice:'12.00',observedAt:n===1?at:'2026-11-08T17:00:00.001Z'}})}));
 let clock=0;p.value.now=()=>new Date(Date.parse(at)+(clock++===0?0:1));let r=await evaluateInitialOutreach(i,p.value);assert.equal(r.kind,'ready');
 const denied=ports(i,(_,n)=>{if(n===2)throw Object.assign(new Error('revoked'),{code:'DENIED'});return {product:product(i)};});r=await evaluateInitialOutreach(i,denied.value);assert.equal(r.kind==='refused'&&r.reasonCode,'DENIED');assert.equal(denied.calls.length,2);
});
for (const boundary of ['evaluatedAt expiry', 'COMPLETE expiry', 'COMPLETE cancellation', 'final clock cancellation', 'just before expiry'] as const) {
    test(`final ready boundary: ${boundary}`, async () => {
        const i = fixture(), p = ports(i);
        const expires = Date.parse(at) + i.limits.deadlineMs;
        let clock = Date.parse(at), completing = false;
        p.value.now = () => {
            if (completing && boundary === 'final clock cancellation') p.controller.abort();
            const date = new Date(clock);
            date.toISOString = () => {
                if (boundary === 'evaluatedAt expiry') clock = expires;
                if (boundary === 'just before expiry') clock = expires - 1;
                return new Date(clock).toISOString();
            };
            return date;
        };
        p.value.log = event => {
            if (event.stage !== 'COMPLETE') return;
            completing = true;
            if (boundary === 'COMPLETE expiry') clock = expires;
            if (boundary === 'COMPLETE cancellation') p.controller.abort();
        };
        const r = await evaluateInitialOutreach(i, p.value);
        if (boundary === 'just before expiry') {
            assert.equal(r.kind, 'ready');
            if (r.kind === 'ready') assert.equal(Date.parse(r.evaluatedAt), expires - 1);
        } else {
            assert.equal(r.kind, 'refused');
            if (r.kind === 'refused') assert.equal(r.reasonCode, boundary.includes('cancellation') ? 'CANCELLED' : 'DEADLINE');
        }
        assert.equal(p.calls.length, 2);
        assert.equal(p.modelCalls, 0);
        assert.equal(r.toolActivity.length, 2);
        assert.ok(p.calls.every(call => call.signal === p.value.signal));
    });
}
