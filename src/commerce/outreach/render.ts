import { InitialOutreachRenderInputSchema, InitialOutreachRenderResultSchema, type InitialOutreachRenderInput, type InitialOutreachRenderResult } from './template-contracts.js';
import { selectRecoveryAssignment, purposeFor } from './selection.js';
import { prepareFrozenComponents } from './bindings.js';
import { selectSendableOutreachOffer } from './sendable-offer.js';
import { BindingUnavailable, PreparedVariableResolver } from './variables.js';
export function renderInitialOutreachPreview(raw: InitialOutreachRenderInput): InitialOutreachRenderResult {
    const parsed = InitialOutreachRenderInputSchema.safeParse(raw);
    if (!parsed.success)
        return { kind: 'refused', reasonCode: 'INVALID_REQUEST' };
    const input = parsed.data;
    let projection = input.preparedProjection;
    if (!projection)
        return { kind: 'refused', reasonCode: 'NO_APPROVED_ASSIGNMENT' };
    const sendable = selectSendableOutreachOffer(input.evaluation.offerDecision);
    const offer = sendable.presentation;
    const purpose = purposeFor('INITIAL', offer);
    let image = projection.variant.metaRegistration?.componentsSnapshot.some(c => c.type === 'HEADER' && 'format' in c && c.format === 'IMAGE');
    if (image && !input.headerMedia) {
        if (!projection.textFallback)
            return { kind: 'refused', reasonCode: 'MEDIA_NOT_READY' };
        projection = projection.textFallback;
        image = false;
    }
    const v = projection.variant;
    const selected = selectRecoveryAssignment({ shop: { id: input.evaluation.shopId, status: 'ACTIVE', defaultLanguageTag: projection.canonicalLanguageTag }, shopId: input.evaluation.shopId, senderWabaId: v.providerAccountId, purpose, variants: [v], stage: 'INITIAL', promotionTarget: 'CHECKOUT', offer, offerCount: sendable.members.length, conversationLanguageTag: projection.canonicalLanguageTag, merchantLanguageTag: projection.canonicalLanguageTag, platformFallbackEnabled: false, platformFallbackLanguageTag: null, headerFormat: image ? 'IMAGE' : 'TEXT', logger: { warn() { } } });
    if (selected.outcome === 'unavailable')
        return { kind: 'refused', reasonCode: selected.reason };
    const registration = v.metaRegistration!;
    try {
        const prepared = prepareFrozenComponents({ registration, variables: new PreparedVariableResolver(input, projection.canonicalLanguageTag, sendable) });
        const body = registration.componentsSnapshot.find(c => c.type === 'BODY');
        if (!body || !('text' in body))
            throw new BindingUnavailable('BINDINGS_INVALID');
        const params = prepared.components.find(c => c.type === 'body')?.parameters ?? [];
        const renderedText = body.text.replace(/\{\{([1-9][0-9]*)\}\}/g, (_, n: string) => {
            const value = params[Number(n) - 1];
            if (!value || value.type !== 'text')
                throw new BindingUnavailable('BINDINGS_INVALID');
            return value.text;
        });
        if (renderedText.length > 4096)
            return { kind: 'refused', reasonCode: 'MESSAGE_TOO_LARGE' };
        const fullText = registration.componentsSnapshot.flatMap(component => {
            if (component.type === 'BODY')
                return [renderedText];
            if (component.type === 'FOOTER')
                return [component.text];
            if (component.type === 'HEADER' && component.format === 'TEXT') {
                const headerParams = prepared.components.find(c => c.type === 'header')?.parameters ?? [];
                return [component.text.replace(/\{\{([1-9][0-9]*)\}\}/g, (_, n: string) => { const p = headerParams[Number(n) - 1]; if (!p || p.type !== 'text')
                        throw new BindingUnavailable('BINDINGS_INVALID'); return p.text; })];
            }
            return [];
        }).join('\n');
        return InitialOutreachRenderResultSchema.parse({ kind: 'ready', purpose, templateProvenance: { variantId: v.id, registrationId: registration.id, definitionId: registration.locale.definition.id, providerTemplateId: registration.providerTemplateId, providerTemplateName: registration.providerTemplateName, providerLanguageCode: registration.providerLanguageCode, submittedContentHash: registration.submittedContentHash, bindingFingerprint: prepared.bindingFingerprint }, parameters: prepared.components, headerPreview: image ? input.headerMedia : null, renderedText: fullText });
    }
    catch (e) {
        return { kind: 'refused', reasonCode: e instanceof BindingUnavailable ? e.reason : 'BINDINGS_INVALID' };
    }
}
