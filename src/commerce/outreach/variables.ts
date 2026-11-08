import type { SendableOutreachOffer } from './sendable-offer.js';
import type { z } from 'zod';
import { SemanticKeySchema } from './template-contracts.js';
import type { InitialOutreachRenderInput } from './template-contracts.js';
import type { TemplateUnavailableReason, RecoveryTemplateHeaderMediaRole } from './template-types.js';
import { formatCheckoutItemsSummary } from './recovery-template-items-summary.js';
export type SemanticKey = z.infer<typeof SemanticKeySchema>;
export function isSemanticKey(v: unknown): v is SemanticKey { return SemanticKeySchema.safeParse(v).success; }
export class BindingUnavailable extends Error {
    constructor(readonly reason: TemplateUnavailableReason) { super(reason); }
}
function boundedText(v: unknown, limit: number): string {
    if (typeof v !== 'string' || !v.trim() || v.length > limit || /[\x00-\x1f\x7f\u2028\u2029]/u.test(v) || v.includes('{{') || v.includes('}}'))
        throw new BindingUnavailable('BINDING_VALUE_UNAVAILABLE');
    try {
        encodeURIComponent(v);
    }
    catch {
        throw new BindingUnavailable('BINDING_VALUE_UNAVAILABLE');
    }
    return v.trim();
}
export class PreparedVariableResolver {
    constructor(private input: InitialOutreachRenderInput, private languageTag: string, private sendable: SendableOutreachOffer) { }
    encodeCheckoutButtonSuffix(_prefix: string): string { return encodeURIComponent(this.input.variables.checkoutUrl); }
    encodePromotionButtonSuffix(_prefix: string): never { throw new BindingUnavailable('PROMOTION_PRODUCT_URL_UNAVAILABLE'); }
    checkStaticButtonUrl(value: string): void {
        const u = new URL(value), checkout = new URL(this.input.variables.checkoutUrl);
        if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.hostname !== checkout.hostname)
            throw new BindingUnavailable('CHECKOUT_UNTRUSTED');
    }
    imageHeader(role: RecoveryTemplateHeaderMediaRole): string {
        const m = this.input.headerMedia;
        if (!m || m.shopId !== this.input.evaluation.shopId || m.role !== role)
            throw new BindingUnavailable('MEDIA_NOT_READY');
        return m.httpsUrl;
    }
    private brandMedia(role: 'logo' | 'squareLogo' | 'coverImage'): string {
        const media = this.input.preparedBrandMedia?.[role];
        if (!media) throw new BindingUnavailable('MEDIA_NOT_READY');
        boundedText(media.httpsUrl, 2048);
        return media.httpsUrl;
    }
    resolve(key: SemanticKey): string {
        const i = this.input, d = this.sendable;
        switch (key) {
            case 'customer.firstName': return boundedText(i.variables.customerFirstName, 200);
            case 'shop.name': return boundedText(i.variables.shopName, 200);
            case 'shop.categoryName': return boundedText(i.variables.shopCategory, 200);
            case 'checkout.url': return i.variables.checkoutUrl;
            case 'checkout.itemsSummary': {
                const items = i.evaluation.lines.map(l => ({ title: l.currentProduct.title, quantity: l.quantity, variantTitle: l.currentProduct.selectedOptions?.map(o => o.value).join(' / ') || null }));
                if (items.some(l => l.quantity > 99999 || /[\p{Cc}\p{Cf}{}]/u.test(l.title) || l.title.length > 160 || l.variantTitle !== null && (/[\p{Cc}\p{Cf}{}]/u.test(l.variantTitle) || l.variantTitle.length > 160)))
                    throw new BindingUnavailable('BINDING_VALUE_UNAVAILABLE');
                return boundedText(formatCheckoutItemsSummary(items, this.languageTag), 500);
            }
            case 'offer.code':
                if (d.presentation === 'CODE_OFFER' && d.members.length === 1 && d.members[0]?.method === 'CODE')
                    return boundedText(d.members[0].code, 100);
                break;
            case 'offer.codes':
                if (d.presentation === 'CODE_OFFER' && d.members.every(m => m.method === 'CODE'))
                    return d.members.map(m => boundedText(m.code, 100)).join(', ');
                break;
            case 'offer.description':
                if (d.presentation !== 'NO_OFFER')
                    return boundedText(d.members.map(m => m.description).join(', '), 200);
                break;
            case 'shopBrand.brandName': return boundedText(i.preparedBrand?.brandName, 200);
            case 'shopBrand.logoAltText': return boundedText(i.preparedBrand?.logoAltText, 200);
            case 'shopBrand.squareLogoAltText': return boundedText(i.preparedBrand?.squareLogoAltText, 200);
            case 'shopBrand.logoWidth':
            case 'shopBrand.logoHeight': {
                const value = key === 'shopBrand.logoWidth' ? i.preparedBrand?.logoWidth : i.preparedBrand?.logoHeight;
                if (value === null || value === undefined) throw new BindingUnavailable('BINDING_VALUE_UNAVAILABLE');
                return boundedText(String(value), 200);
            }
            case 'shopBrand.logoUrl': return this.brandMedia('logo');
            case 'shopBrand.squareLogoUrl': return this.brandMedia('squareLogo');
            case 'shopBrand.coverImageUrl': return this.brandMedia('coverImage');
        }
        throw new BindingUnavailable('BINDING_VALUE_UNAVAILABLE');
    }
}
