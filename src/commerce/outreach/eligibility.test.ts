import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePurchaseDiscount, type ObservedDiscount } from './eligibility.js';
import { selectCompatibleOffers } from './combinations.js';
import { decimalToMinorUnits, minorUnitsToDecimal } from './money.js';
import { details } from './test-fixtures.js';
import { at } from './test-fixtures.js';
const purchase = { provider: 'SHOPIFY' as const, mode: 'AI_BEST_APPLICABLE' as const, authorisedDiscountIds: [], currency: 'USD', lines: [{ lineKey: 'line-1', productId: 'gid://shopify/Product/1', variantId: null, categoryIds: null, collectionIds: null, isSaleItem: false, quantity: 2 }], currentMerchandiseSubtotal: { amountDecimal: '24.00', currency: 'USD' } };
function observe(id = 'offer-1'): ObservedDiscount { const d = details(id); d.offer.code = "SAVE" + id; return { offer: d.offer, details: d, eligibility: evaluatePurchaseDiscount({ purchase, offerFromOptions: d.offer, details: d, evaluatedAt: new Date(at) }) }; }
test('ported eligibility goldens: exclusions, unknown membership, thresholds and incomplete usage', () => {
    assert.equal(observe().eligibility.verdict, 'SUPPORTED');
    for (const [change, verdict] of [
        [(d: ReturnType<typeof details>) => { d.facts.targeting.excludedProductIds = ['gid://shopify/Product/1']; }, 'NOT_APPLICABLE'],
        [(d: ReturnType<typeof details>) => { d.facts.minimumSubtotal = '24.01'; }, 'NOT_APPLICABLE'],
        [(d: ReturnType<typeof details>) => { d.facts.targeting.kind = 'CATEGORIES'; d.facts.targeting.includedCategoryIds = ['cat-1']; }, 'UNVERIFIABLE'],
        [(d: ReturnType<typeof details>) => { d.facts.usageCount = null; }, 'UNVERIFIABLE'],
        [(d: ReturnType<typeof details>) => { d.facts.perCustomerLimit = 1; }, 'UNVERIFIABLE']
    ] as const) {
        const d = details();
        change(d);
        assert.equal(evaluatePurchaseDiscount({ purchase, offerFromOptions: d.offer, details: d, evaluatedAt: new Date(at) }).verdict, verdict);
    }
});
test('ported combination goldens preserve max3, reciprocal Shopify and Woo individual-use', () => {
    const a = observe('a'), b = observe('b'), c = observe('c');
    for (const o of [a, b, c]) {
        o.details.facts.combination.discountClasses = ['ORDER'];
    }
    assert.deepEqual(selectCompatibleOffers({ candidates: [a, b, c], proposedOfferIds: ['a', 'b', 'c', 'outside'] }).offerIds, ['a', 'b', 'c']);
    b.details.facts.combination.combinesWith!.orderDiscounts = false;
    assert.deepEqual(selectCompatibleOffers({ candidates: [a, b], proposedOfferIds: ['a', 'b'] }).offerIds, ['a']);
    for (const o of [a, b]) {
        o.details.facts.provider = 'WOOCOMMERCE';
        o.details.facts.individualUse = false;
    }
    assert.deepEqual(selectCompatibleOffers({ candidates: [a, b], proposedOfferIds: ['a', 'b'] }).offerIds, ['a', 'b']);
    b.details.facts.individualUse = true;
    assert.deepEqual(selectCompatibleOffers({ candidates: [a, b], proposedOfferIds: ['a', 'b'] }).offerIds, ['a']);
});
test('decimal arithmetic currency precision goldens', () => { assert.equal(decimalToMinorUnits('0.10', 'USD'), 10n); assert.equal(decimalToMinorUnits('1.001', 'USD'), null); assert.equal(decimalToMinorUnits('123', 'JPY'), 123n); assert.equal(minorUnitsToDecimal(1234n, 'KWD'), '1.234'); });
