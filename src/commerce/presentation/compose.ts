import { renderCommerceProductFacts } from "./facts.js";
import { CommerceFinalResponseSchema, type CommerceFinalResponse } from "../response.js";
import { CommerceVerifiedPresentationSchema, type CommerceVerifiedPresentation } from "./schemas.js";
import { normalizeCommerceReplyText } from "./format.js";
import { renderRecommendationReply } from "./render.js";
import { renderProductOptionFacts } from "./options.js";
import { buildReplyCandidates } from "./candidates.js";
import { canonicalTag, chooseSlot, languageChoices, validDefinition } from "./wrapper-selection.js";
import { readPreparedWrapper, type PresentationDigest } from "./wrapper-projection.js";
import { renderPreparedWrapper } from "./wrapper-render.js";
import { resolveModaConfigurationLocale } from "../../internationalization.js";
import type { VerifiedWrapperContext, WrapperSlot } from "./wrapper-contracts.js";
export type CommerceWhatsAppPreviewInput = {
 envelope: CommerceFinalResponse;
 /** Follow-up replies preserve the grounded agent wording; initial outreach uses its own renderer. */
 responseStyle?: "AGENT";
 presentation: import("zod").input<typeof CommerceVerifiedPresentationSchema>;
 /** Must agree with the host-verified projection. */
 locale?: string;
 brandName?: string | null;
 wrapper?: {slots:readonly WrapperSlot[];context:VerifiedWrapperContext;digest:PresentationDigest;platformFallbackLanguageTag?:string|null;languageTag?:string|null} | null;
};
export type CommerceWhatsAppPreviewResult={kind:"ready";body:string;candidates:readonly string[];wrapper:{definitionId:string;localeId:string;contentHash:string;slotEditVersion:number}|null}|{kind:"refused";reason:string};
function candidatesFor(envelope:CommerceFinalResponse,p:import("zod").output<typeof CommerceVerifiedPresentationSchema>):readonly string[] {
 if(envelope.answerKind==="REFER_TO_STORE")return buildReplyCandidates({fullBody:normalizeCommerceReplyText(envelope.replyText),minimalBody:normalizeCommerceReplyText(envelope.replyText)});
 if(p.disposition==="PRODUCT_DETAILS")return buildReplyCandidates({fullBody:renderCommerceProductFacts(p.productFacts,p.locale),firstProductBody:p.productFacts.length>1?renderCommerceProductFacts(p.productFacts.slice(0,1),p.locale):null,minimalBody:renderCommerceProductFacts([],p.locale)});
 if(p.disposition==="PRODUCT_OPTIONS")return buildReplyCandidates({fullBody:renderProductOptionFacts(p.optionFacts,p.locale),firstProductBody:p.optionFacts.length>1?renderProductOptionFacts(p.optionFacts.slice(0,1),p.locale):null,minimalBody:renderProductOptionFacts([],p.locale)});
 if(p.products.length||p.disposition!=="STANDARD"||p.requiresShipping!==null||p.policyUrl){
  const shared={locale:p.locale,disposition:p.disposition,storeUrl:p.storeUrl,policyUrl:p.policyUrl,requiresShipping:p.requiresShipping};
  return buildReplyCandidates({fullBody:renderRecommendationReply({...shared,products:p.products,includeNoVerifiedOffer:p.includeNoVerifiedOffer}),firstProductBody:p.products.length?renderRecommendationReply({...shared,products:p.products.slice(0,1),includeNoVerifiedOffer:p.includeNoVerifiedOffer}):null,minimalBody:renderRecommendationReply({...shared,products:[]})});
 }
 const body=normalizeCommerceReplyText(envelope.replyText);return buildReplyCandidates({fullBody:body,minimalBody:body});
}
/** Pure formatting/projection only; never moderation, billing or send admission. */
export function composeCommerceWhatsAppPreview(input:CommerceWhatsAppPreviewInput):CommerceWhatsAppPreviewResult {
 try {
  const envelope=CommerceFinalResponseSchema.parse(input.envelope),p=CommerceVerifiedPresentationSchema.parse(input.presentation);
  if((input.locale!==undefined&&resolveModaConfigurationLocale(input.locale)!==p.locale)||(input.brandName!==undefined&&input.brandName!==p.brandName))return {kind:"refused",reason:"INVALID_INPUT"};
  const candidates=input.responseStyle==="AGENT"?buildReplyCandidates({fullBody:normalizeCommerceReplyText(envelope.replyText),minimalBody:normalizeCommerceReplyText(envelope.replyText)}):candidatesFor(envelope,p);if(candidates[0]&&/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(candidates[0]))return {kind:"refused",reason:"INVALID_INPUT"};if(!candidates.length)return {kind:"refused",reason:"OUTPUT_TOO_LONG"};
  const w=input.wrapper;
  // With no configured wrapper, still enforce the plain-text controls and bounds.
  if(!w||!w.slots.length){const body=candidates[0]!;if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body))return {kind:"refused",reason:"INVALID_INPUT"};return {kind:"ready",body,candidates,wrapper:null};}
  const slot=chooseSlot(w.slots,"AI");if(!slot)return {kind:"ready",body:candidates[0]!,candidates,wrapper:null};if(slot==="invalid"||!validDefinition(slot.definition,slot))return {kind:"refused",reason:"DEFINITION_UNAVAILABLE"};
  const choices=languageChoices({conversationTag:w.context.conversationLanguageTag,merchantTag:w.context.merchantLanguageTag,preferredTag:w.languageTag,platformFallbackTag:w.platformFallbackLanguageTag??null});
  if(choices==="invalid")return {kind:"refused",reason:"INVALID_LANGUAGE"};
  const effectiveTag=canonicalTag(w.context.conversationLanguageTag),bodyLocale=resolveModaConfigurationLocale(effectiveTag);
  if(bodyLocale!==p.locale)return {kind:"refused",reason:"INVALID_LANGUAGE"};
  const language=new Intl.Locale(bodyLocale).language;
  const lookup=[...new Set([effectiveTag,bodyLocale,...choices].filter((tag):tag is string=>tag!==null))].filter(tag=>new Intl.Locale(tag).language===language&&resolveModaConfigurationLocale(tag)===bodyLocale);
  const locale=lookup.map(tag=>slot.definition.locales.find(row=>row.languageTag===tag)).find(row=>row!==undefined);
  if(!locale||locale.status!==(locale.languageTag==="en"?"SOURCE_SAVED":"REVIEWED")||locale.providerLanguageCode!==null||(locale.languageTag!=="en"&&(!locale.reviewedAt||!locale.reviewedByAdminId)))return {kind:"refused",reason:"LOCALE_UNAVAILABLE"};
  const projection=readPreparedWrapper(locale.localeAst,locale.contentHash,w.digest);if(projection.kind!=="ok")return {kind:"refused",reason:projection.kind==="missing"?"PREPARED_MISSING":"PREPARED_INVALID"};
  for(const candidate of candidates){const rendered=renderPreparedWrapper({prepared:projection.prepared,context:w.context,responseBody:candidate});if(rendered.kind==="rendered")return {kind:"ready",body:rendered.body,candidates,wrapper:{definitionId:slot.definitionId,localeId:locale.id,contentHash:locale.contentHash!,slotEditVersion:slot.editVersion}};if(rendered.reason!=="OUTPUT_TOO_LONG")return {kind:"refused",reason:rendered.reason};}
  return {kind:"refused",reason:"OUTPUT_TOO_LONG"};
 } catch {return {kind:"refused",reason:"INVALID_INPUT"};}
}
