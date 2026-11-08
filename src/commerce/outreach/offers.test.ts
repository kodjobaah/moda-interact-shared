import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInitialOutreach } from './evaluate.js';
import { details, fixture, product, ports, at } from './test-fixtures.js';
import { CommerceDiscountDetailsSchema, type CommerceDiscountDetails } from '../schemas.js';
import { EligibilitySchema, GroupSchema, OfferDecisionSchema } from './contracts.js';
test('FIXED reads only authorized details, uses live subtotal, rechecks selected details', async () => {
    const i = fixture();
    i.policy = { mode: 'FIXED', authorisedDiscountIds: ['offer-1'] };
    const d = details();
    const p = ports(i, c => c.name === 'commerce_get_product' ? { product: product(i) } : { details: d });
    const r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        return;
    assert.deepEqual(p.calls.map(c => c.name), ['commerce_get_product', 'commerce_get_discount_details', 'commerce_get_product', 'commerce_get_discount_details']);
    assert.equal(p.modelCalls, 0);
    assert.equal(r.offerDecision.kind, 'CHECKOUT_DISCOUNT');
    if (r.offerDecision.kind === 'CHECKOUT_DISCOUNT') {
        assert.deepEqual(r.offerDecision.group.offerIds, ['offer-1']);
        assert.deepEqual(r.offerDecision.members[0]!.eligibility.eligibleLineKeys, ['line-1']);
        assert.equal(r.offerDecision.offerSet.offers[0]!.code, 'SAVE10');
    }
    assert.ok(OfferDecisionSchema.safeParse(r.offerDecision).success);
});
test('FIXED no eligible offer succeeds, changed selected offer refuses', async () => {
    const i = fixture();
    i.policy = { mode: 'FIXED', authorisedDiscountIds: ['offer-1'] };
    let d = details();
    d.facts.minimumSubtotal = '25';
    let p = ports(i, c => c.name === 'commerce_get_product' ? { product: product(i) } : { details: d });
    let r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind === 'ready' && r.offerDecision.kind, 'NO_VERIFIED_OFFER');
    assert.equal(p.calls.length, 3);
    d = details();
    let reads = 0;
    p = ports(i, c => {
        if (c.name === 'commerce_get_product')
            return { product: product(i) };
        reads++;
        return { details: reads === 1 ? d : { ...d, offer: { ...d.offer, code: 'CHANGED' } } };
    });
    r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'CURRENT_FACTS_CHANGED');
});
test('AI bounded identifier graph lists then details then submit; excludes search and alternative schema', async () => {
    const i = fixture();
    i.policy.mode = 'AI_BEST_APPLICABLE';
    const d = details(), p = ports(i, c => c.name === 'commerce_get_product' ? { product: product(i) } : c.name === 'commerce_get_discount_options' ? { mode: i.policy.mode, offers: [d.offer], truncated: false } : { details: d });
    let n = 0;
    p.value.modelInvoker = { async invoke(request, signal) { assert.equal(signal, p.value.signal); assert.ok(!JSON.stringify(request.tools).includes('ALTERNATIVE_PRODUCT_PROMOTION')); assert.ok(!request.tools.some(t => t.name.includes('search'))); n++; return { outputTokens: 10, calls: n === 1 ? [{ name: 'commerce_get_discount_options', arguments: {} }] : n === 2 ? [{ name: 'commerce_get_discount_details', arguments: { offerId: 'offer-1' } }] : [{ name: 'submitInitialOutreachOffer', arguments: { kind: 'CHECKOUT_DISCOUNT', offerIds: ['offer-1'] } }] }; } };
    const r = await evaluateInitialOutreach(i, p.value);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        return;
    assert.equal(r.offerDecision.kind, 'CHECKOUT_DISCOUNT');
    assert.equal(n, 3);
    assert.deepEqual(r.toolActivity.map(a => a.toolName), ['commerce_get_product', 'model.invoke', 'commerce_get_discount_options', 'model.invoke', 'commerce_get_discount_details', 'model.invoke', 'commerce_get_product', 'commerce_get_discount_details']);
});
for (const name of ['alternative', 'search', 'malformed choice', 'unobserved choice', 'model steps', 'output tokens'])
    test(`AI refuses ${name}`, async () => {
        const i = fixture();
        i.policy.mode = 'AI_BEST_APPLICABLE';
        const p = ports(i, c => c.name === 'commerce_get_product' ? { product: product(i) } : { mode: i.policy.mode, offers: [], truncated: false });
        let n = 0;
        p.value.modelInvoker = { async invoke() {
                n++;
                if (name === 'alternative')
                    return { outputTokens: 1, calls: [{ name: 'submitInitialOutreachOffer', arguments: { kind: 'ALTERNATIVE_PRODUCT_PROMOTION' } }] };
                if (name === 'search')
                    return { outputTokens: 1, calls: [{ name: 'commerce_search_products', arguments: {} }] };
                if (name === 'output tokens')
                    return { outputTokens: 1000, calls: [{ name: 'commerce_get_discount_options', arguments: {} }] };
                if (n === 1)
                    return { outputTokens: 1, calls: [{ name: 'commerce_get_discount_options', arguments: {} }] };
                return { outputTokens: 1, calls: [{ name: 'submitInitialOutreachOffer', arguments: name === 'malformed choice' ? { kind: 'CHECKOUT_DISCOUNT', offerIds: 'bad' } : { kind: 'CHECKOUT_DISCOUNT', offerIds: ['unobserved'] } }] };
            } };
        if (name === 'model steps')
            i.limits.modelSteps = 1;
        const r = await evaluateInitialOutreach(i, p.value);
        assert.equal(r.kind === 'refused' && r.reasonCode, ['alternative', 'search'].includes(name) ? 'OUTSIDE_CHECKOUT' : ['model steps', 'output tokens'].includes(name) ? 'BUDGET_EXHAUSTED' : 'INVALID_RESULT');
    });
test('nested price/eligibility/combination payloads strictly rejected', () => {
    const d = details();
    assert.ok(CommerceDiscountDetailsSchema.safeParse(d).success);
    assert.equal(CommerceDiscountDetailsSchema.safeParse({ ...d, facts: { ...d.facts, combination: { ...d.facts.combination, combinesWith: 'anything' } } }).success, false);
    assert.equal(EligibilitySchema.safeParse({ offerId: '1', verdict: 'SUPPORTED', eligibleLineKeys: ['1'], reasonCodes: [], extra: true }).success, false);
    assert.equal(GroupSchema.safeParse({ verdict: 'SUPPORTED', offerIds: ['1'], reasonCodes: [{}] }).success, false);
});
