import { createHash } from 'node:crypto';
import { InitialOutreachEvaluationInputSchema, type InitialOutreachEvaluationInput, type ReadyEvaluation } from './contracts.js';
import { decimalToMinorUnits, minorUnitsToDecimal } from './money.js';
import type { CommerceProduct } from '../schemas.js';
export function fingerprintInitialOutreachBasket(raw: InitialOutreachEvaluationInput): string {
    const input = InitialOutreachEvaluationInputSchema.parse(raw);
    // Same ordered, explicit-null canonical price basket algorithm; host attempt identity excluded.
    const canonical = { currency: input.checkout.currency, lineItems: input.checkout.lines.map(l => ({ productId: l.productId, variantId: l.variantId, title: null, variantTitle: null, sku: null, quantity: l.quantity, price: l.checkoutUnitPrice })) };
    return createHash('sha256').update('ARCH052_PRICE_BASKET_V1\0' + JSON.stringify(canonical), 'utf8').digest('hex');
}
export function productKey(p: {
    productId: string;
    variantId: string | null;
}): string { return JSON.stringify([p.productId, p.variantId]); }
export function currentFacts(p: CommerceProduct): string { const { observedAt, saleEvidence, ...facts } = p; const sale = saleEvidence ? { regularPrice: saleEvidence.regularPrice, salePrice: saleEvidence.salePrice } : saleEvidence; return JSON.stringify({ ...facts, ...(saleEvidence === undefined ? {} : { saleEvidence: sale }) }); }
export class OutreachRefusal extends Error {
    constructor(readonly code: import('./contracts.js').RefusalReason) { super(code); }
}
export function reconcileLines(input: InitialOutreachEvaluationInput, products: Map<string, CommerceProduct>): Pick<ReadyEvaluation, 'lines' | 'currentMerchandiseSubtotal'> {
    let subtotal = 0n;
    const lines = input.checkout.lines.map(l => {
        const p = products.get(productKey(l))!;
        if (p.currency !== input.checkout.currency)
            throw new OutreachRefusal('CURRENCY_MISMATCH');
        if (p.unitPrice === null)
            throw new OutreachRefusal('PRICE_UNAVAILABLE');
        const live = decimalToMinorUnits(p.unitPrice, p.currency);
        if (live === null)
            throw new OutreachRefusal('ARITHMETIC_UNSAFE');
        subtotal += live * BigInt(l.quantity);
        if (subtotal > BigInt(Number.MAX_SAFE_INTEGER))
            throw new OutreachRefusal('ARITHMETIC_UNSAFE');
        const previous = l.checkoutUnitPrice === null ? null : decimalToMinorUnits(l.checkoutUnitPrice, input.checkout.currency);
        return { ...l, currentProduct: p, comparison: previous === null ? 'INCOMPARABLE' as const : previous === live ? 'EQUAL' as const : 'DIFFERENT' as const };
    });
    const amountDecimal = minorUnitsToDecimal(subtotal, input.checkout.currency);
    if (amountDecimal === null)
        throw new OutreachRefusal('ARITHMETIC_UNSAFE');
    return { lines, currentMerchandiseSubtotal: { amountDecimal, currency: input.checkout.currency } };
}
