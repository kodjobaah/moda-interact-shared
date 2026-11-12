import { providerObservationHash } from './provider-observation.js';
import { createHash } from 'node:crypto';
import type { InitialOutreachEvaluationInput, InitialOutreachPorts, InitialOutreachToolCall, ReadyEvaluation } from './contracts.js';
import type { InitialOutreachRenderInput } from './template-contracts.js';
import type { CommerceProduct } from '../schemas.js';
export const at = '2026-11-08T17:00:00.000Z';
export function fixture(platform: 'SHOPIFY' | 'WOOCOMMERCE' = 'SHOPIFY'): InitialOutreachEvaluationInput {
    return { schemaVersion: 1, runId: 'run-1', shopId: 'shop-1', platform, environment: 'TEST', checkout: { id: 'checkout-1', generation: 1, currency: 'USD', url: 'https://shop.example/checkout/1', lines: [{ lineKey: 'line-1', productId: platform === 'SHOPIFY' ? 'gid://shopify/Product/1' : '1', variantId: null, quantity: 2, checkoutUnitPrice: '10.00' }] }, policy: { mode: 'NONE', authorisedDiscountIds: [] }, instructions: { platformText: 'Platform safety.', platformRevisionId: 'platform-1', merchantText: null, merchantRevisionId: null, purposeText: 'Select current checkout offers.', purposeProfileRevisionId: 'purpose-1' }, limits: { deadlineMs: 1000, modelSteps: 8, remoteCalls: 16, outputTokens: 512 } };
}
export function product(input = fixture(), override: Partial<CommerceProduct> = {}): CommerceProduct { return { productId: input.checkout.lines[0]!.productId, variantId: null, title: 'Custom label', url: 'https://shop.example/products/1', available: true, unitPrice: '12.00', currency: 'USD', productType: null, vendor: null, observedAt: at, ...override }; }
export function ports(input = fixture(), read?: (c: InitialOutreachToolCall, index: number) => unknown) {
    const calls: InitialOutreachToolCall[] = [];
    let modelCalls = 0;
    const controller = new AbortController();
    const value: InitialOutreachPorts = { signal: controller.signal, now: () => new Date(at), callTool: async (c) => { calls.push(c); return read ? read(c, calls.length) : { product: product(input, { productId: 'productId' in c.arguments ? c.arguments.productId : input.checkout.lines[0]!.productId, variantId: 'variantId' in c.arguments ? c.arguments.variantId : null }) }; }, modelInvoker: { async invoke() { modelCalls++; throw new Error('Unexpected model call'); } }, log() { } };
    return { value, calls, controller, get modelCalls() { return modelCalls; } };
}
export function stable(value: unknown): string {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
}
export function renderFixture(evaluation: ReadyEvaluation): InitialOutreachRenderInput {
    const components = [{ type: 'BODY' as const, text: 'Hello {{1}} from {{2}}: {{3}}', example: { body_text: [['Alex', 'Merchant', '2 × Custom label']] } }, { type: 'BUTTONS' as const, buttons: [{ type: 'URL' as const, text: 'Resume checkout', url: 'https://shop.example/resume?url={{1}}' }] }];
    const bindings = { promotionTarget: 'CHECKOUT' as const, header: [], body: [{ position: 1, variable: 'customer.firstName' as const }, { position: 2, variable: 'shop.name' as const }, { position: 3, variable: 'checkout.itemsSummary' as const }], buttons: [{ index: 0, subType: 'url' as const, variable: 'checkout.url' as const }] };
    const digest = createHash('sha256').update(stable({ schemaVersion: 1, family: 'META_RECOVERY', category: 'MARKETING', components, parameterBindings: bindings })).digest('hex');
    const registration = { id: 'registration-1', wabaId: 'waba-1', providerTemplateName: 'moda_initial_no_offer', providerLanguageCode: 'en_US', providerTemplateId: 'provider-template-1', category: 'MARKETING', providerStatus: 'APPROVED', submissionState: 'SUBMITTED', failureCode: null, lastObservedContentHash: providerObservationHash(components)!, lastObservedCategory: 'MARKETING', driftDetectedAt: null, submittedContentHash: digest, componentsSnapshot: components, parameterBindingsSnapshot: bindings, locale: { id: 'locale-1', languageTag: 'en', providerLanguageCode: 'en_US', status: 'REVIEWED', contentHash: digest, definition: { id: 'definition-1', kind: 'META_RECOVERY', purpose: 'INITIAL', offerType: 'NO_OFFER', status: 'PUBLISHED', category: 'MARKETING', providerTemplateName: 'moda_initial_no_offer', publishedAt: at, retiredAt: null } } };
    return { schemaVersion: 1, evaluation, preparedProjection: { variant: { id: 'variant-1', shopId: evaluation.shopId, providerAccountId: 'waba-1', purpose: 'INITIAL_NO_OFFER', languageTag: 'en', providerLanguageCode: 'en_US', providerTemplateName: 'moda_initial_no_offer', providerTemplateId: 'provider-template-1', status: 'APPROVED', enabled: true, metaRegistrationId: 'registration-1', metaRegistration: registration }, canonicalLanguageTag: 'en', selectionSource: 'exact' }, variables: { shopName: 'Merchant', customerFirstName: 'Test customer', checkoutUrl: 'https://shop.example/checkout/1', shopCategory: 'Custom' }, headerMedia: null };
}
import type { CommerceDiscountDetails } from '../schemas.js';
export function details(id = 'offer-1'): CommerceDiscountDetails {
    return { offer: { offerId: id, title: 'Save ten percent', method: 'CODE', code: 'SAVE10', startsAt: null, endsAt: null, support: 'SUPPORTED', reasonCodes: [] }, providerDiscountId: 'provider-' + id, facts: { provider: 'SHOPIFY', completeness: 'COMPLETE', observedAt: at, providerStatus: 'ACTIVE', unavailableAt: null, discountKind: 'PERCENTAGE', discountValue: '10', discountCurrency: 'USD', targeting: { kind: 'PRODUCTS', includedProductIds: ['gid://shopify/Product/1'], includedVariantIds: [], includedCategoryIds: [], includedCollectionIds: [], excludedProductIds: [], excludedVariantIds: [], excludedCategoryIds: [], excludedCollectionIds: [] }, minimumSubtotal: '24', maximumSubtotal: null, subtotalRequirementCurrency: 'USD', minimumQuantity: null, usageLimit: 10, usageCount: 0, perCustomerLimit: 0, customerScope: 'ALL', excludesSaleItems: false, individualUse: null, combination: { discountClasses: ['PRODUCT'], shopifyPlus: null, combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, discountTags: [], allowedSameLineProductTags: [] }, unrepresentedConditions: [] } };
}

export function preparedBrandFixture(): import('./template-contracts.js').PreparedOutreachBrand {
    return {shopId:'shop-1',brandName:'Saved brand',logoAltText:'Saved logo alt',logoWidth:100,logoHeight:200,squareLogoAltText:'Saved square alt'};
}
export function preparedBrandMediaFixture(): import('./template-contracts.js').PreparedOutreachBrandMedia {
    const media = (role: 'LOGO' | 'SQUARE_LOGO' | 'COVER_IMAGE', path: string) => ({shopId:'shop-1',role,status:'READY' as const,kind:'R2_DERIVATIVE' as const,httpsUrl:`https://assets.example/${path}.webp`});
    return {logo:media('LOGO','logo'),squareLogo:media('SQUARE_LOGO','square'),coverImage:media('COVER_IMAGE','cover')};
}
