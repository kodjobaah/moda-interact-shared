import { StudioInitialOutreachRenderInputSchema, StudioInitialOutreachRenderResultSchema, type StudioInitialOutreachRenderInput, type StudioInitialOutreachRenderResult, type RenderReasonSchema } from './template-contracts.js';
import type { z } from 'zod';
import { renderStoredComponentText } from './component-render.js';
import { InitialOutreachRenderInputSchema, InitialOutreachRenderResultSchema, type InitialOutreachRenderInput, type InitialOutreachRenderResult } from './template-contracts.js';
import { selectRecoveryAssignment, purposeFor } from './selection.js';
import { prepareStoredComponents, prepareFrozenComponents } from './bindings.js';
import { selectSendableOutreachOffer } from './sendable-offer.js';
import { BindingUnavailable, PreparedVariableResolver } from './variables.js';
export function renderInitialOutreachPreview(raw: InitialOutreachRenderInput): InitialOutreachRenderResult {
    let parsed: ReturnType<typeof InitialOutreachRenderInputSchema.safeParse>;
    try { parsed = InitialOutreachRenderInputSchema.safeParse(raw); }
    catch { return { kind: 'refused', reasonCode: 'INVALID_REQUEST' }; }
    if (!parsed.success)
        return { kind: 'refused', reasonCode: 'INVALID_REQUEST' };
    const input = parsed.data;
    const assetError = validatePreparedAssets(input);
    if (assetError) return {kind:'refused',reasonCode:assetError};
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
        const fullText = renderStoredComponentText(registration.componentsSnapshot, prepared.components);
        return InitialOutreachRenderResultSchema.parse({ kind: 'ready', purpose, templateProvenance: { variantId: v.id, registrationId: registration.id, definitionId: registration.locale.definition.id, providerTemplateId: registration.providerTemplateId, providerTemplateName: registration.providerTemplateName, providerLanguageCode: registration.providerLanguageCode, submittedContentHash: registration.submittedContentHash, bindingFingerprint: prepared.bindingFingerprint }, parameters: prepared.components, headerPreview: image ? input.headerMedia : null, renderedText: fullText });
    }
    catch (e) {
        return { kind: 'refused', reasonCode: e instanceof BindingUnavailable ? e.reason : 'BINDINGS_INVALID' };
    }
}

type VariableInput = Pick<InitialOutreachRenderInput, 'evaluation'|'variables'|'headerMedia'|'preparedBrand'|'preparedBrandMedia'>;
function validatePreparedAssets(input:VariableInput):z.infer<typeof RenderReasonSchema>|null {
    if (input.preparedBrand && input.preparedBrand.shopId !== input.evaluation.shopId)
        return 'IDENTITY_MISMATCH';
    for (const [key, role] of [['logo', 'LOGO'], ['squareLogo', 'SQUARE_LOGO'], ['coverImage', 'COVER_IMAGE']] as const) {
        const media = input.preparedBrandMedia?.[key];
        if (media) {
            const url = new URL(media.httpsUrl);
            if (media.shopId !== input.evaluation.shopId || media.role !== role || url.hash || media.httpsUrl.includes('#') || !url.hostname.includes('.'))
                return 'MEDIA_NOT_READY';
        }
    }
    return null;
}
export function renderStudioInitialOutreachPreview(raw:StudioInitialOutreachRenderInput):StudioInitialOutreachRenderResult {
 let parsed:ReturnType<typeof StudioInitialOutreachRenderInputSchema.safeParse>;
 try { parsed=StudioInitialOutreachRenderInputSchema.safeParse(raw); } catch { return {kind:'refused',reasonCode:'INVALID_REQUEST'}; }
 if(!parsed.success)return {kind:'refused',reasonCode:'INVALID_REQUEST'};
 const input=parsed.data;
 const assetError=validatePreparedAssets(input);
 if(assetError)return {kind:'refused',reasonCode:assetError};
 try {
  const sendable=selectSendableOutreachOffer(input.evaluation.offerDecision);
  const prepared=prepareStoredComponents({components:input.template.components,bindings:input.template.bindings,variables:new PreparedVariableResolver(input,input.template.languageTag,sendable)});
  const image=input.template.components.some(c=>c.type==='HEADER'&&c.format==='IMAGE');
  return StudioInitialOutreachRenderResultSchema.parse({kind:'ready',renderedText:renderStoredComponentText(input.template.components,prepared.components),parameters:prepared.components,headerPreview:image?input.headerMedia:null,templateId:input.template.templateId,localeId:input.template.localeId,templateValidation:'NOT_EVALUATED'});
 }catch(error){return {kind:'refused',reasonCode:error instanceof BindingUnavailable?error.reason:'BINDINGS_INVALID'};}
}
