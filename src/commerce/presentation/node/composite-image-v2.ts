import {createHash} from 'node:crypto';
import {stableJson} from '../wrapper-projection.js';
import {readRecoveryCompositeProfile,type RecoveryCompositeProfile} from '../composite-profile.js';
import {RecoveryCompositeProvenanceV2Schema,RecoveryPreparedCompositeImageV2Schema,assertRecoveryCompositeProvenanceIdentityV2,assertRecoveryCompositeOutputIdentityV2,digestRecoveryCompositeRenderIdentityV2,type RecoveryCompositeProvenanceV2,type RecoveryPreparedCompositeImageV2} from '../composite-image-v2.js';
import {createRecoveryCompositeImageRendererV2,getRecoveryCompositeRuntimeIdentityV2,type RecoveryCompositeRenderInputV2,type RecoveryCompositeRenderedImageV2} from './composite-renderer-v2.js';
import type {RecoveryCompositePreparationInput,RecoveryCompositePreparationDependencies,RecoveryCompositeOmission,RecoveryCompositePreparationStage} from './composite-preparation-types.js';
import {readCompositeBrandSourceV2,readCompositeProductSourceV2} from './composite-source-v2.js';
import {prepareCompositeImageCore} from './composite-preparation-core.js';
export type RecoveryCompositePreparationInputV2=Omit<RecoveryCompositePreparationInput,'provenance'>&{profile:RecoveryCompositeProfile;profileSha256:string;provenance:RecoveryCompositeProvenanceV2};
export type RecoveryCompositePreparationDependenciesV2=Omit<RecoveryCompositePreparationDependencies,'renderer'>&{renderer?:{render(input:RecoveryCompositeRenderInputV2):Promise<RecoveryCompositeRenderedImageV2>}};
export type RecoveryCompositePreparationV2={kind:'OMITTED';reason:RecoveryCompositeOmission;stage:RecoveryCompositePreparationStage;durationMs:number}|{kind:'READY';image:RecoveryPreparedCompositeImageV2;stage:'READY';durationMs:number;textBounds:Readonly<{width:number;height:number}>};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function prepareRecoveryCompositeImageV2(input:RecoveryCompositePreparationInputV2,deps:RecoveryCompositePreparationDependenciesV2={}):Promise<RecoveryCompositePreparationV2> {
 const start=(deps.now??Date.now)(),profileSha256=input.profileSha256;
 try {
  const profile=readRecoveryCompositeProfile(input.profile,profileSha256,hash),p=RecoveryCompositeProvenanceV2Schema.parse(input.provenance);
  assertRecoveryCompositeProvenanceIdentityV2(p,hash);
  const identity=getRecoveryCompositeRuntimeIdentityV2({profile,profileSha256});
  if(p.profileSha256!==profileSha256||stableJson(p.profile)!==stableJson(profile)||p.fontResourceSha256!==identity.fontResourceSha256||p.runtimeSha256!==identity.runtimeSha256)
   return {kind:'OMITTED',reason:'SOURCE_IDENTITY_INVALID',stage:'CONFIGURATION',durationMs:0};
  return await prepareCompositeImageCore({...input,provenance:p},deps,{
   namespace:'v2',parseLogo:readCompositeBrandSourceV2,parseProduct:readCompositeProductSourceV2,
   productKey:q=>`conversation-products/v1/${hash(q.shopId)}/${hash(stableJson({productId:q.productId,variantId:q.variantId}))}/${q.contentSha256}.jpg`,
   parseProvenance:raw=>RecoveryCompositeProvenanceV2Schema.parse(raw),
   render:args=>(deps.renderer??createRecoveryCompositeImageRendererV2({profile,profileSha256})).render(args),
   dimensions:q=>({width:q.profile.canvasWidth,height:q.product===null?q.profile.headerOnlyHeight:q.profile.withProductHeight}),
   textLimits:q=>({width:q.profile.textWidth,height:q.profile.textHeight}),
   matches:(q,r)=>r.profileSha256===q.profileSha256&&r.fontResourceSha256===q.fontResourceSha256&&r.runtimeSha256===q.runtimeSha256,
   renderIdentity:q=>digestRecoveryCompositeRenderIdentityV2(q,hash),
   prepareOutput:raw=>{const image=RecoveryPreparedCompositeImageV2Schema.parse({...raw as object,schemaVersion:2});assertRecoveryCompositeOutputIdentityV2(image,hash);return image;},
  },start);
 }catch {return {kind:'OMITTED',reason:'CONFIGURATION_UNAVAILABLE',stage:'CONFIGURATION',durationMs:0};}
}
