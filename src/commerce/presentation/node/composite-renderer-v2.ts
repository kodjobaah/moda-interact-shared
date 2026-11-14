import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {readRecoveryCompositeProfile,assertRecoveryCompositeTextAllocationV2,type RecoveryCompositeProfile} from '../composite-profile.js';
import {RecoveryCompositeProvenanceV2Schema,assertRecoveryCompositeProvenanceIdentityV2,type RecoveryCompositeProvenanceV2} from '../composite-image-v2.js';
import {stableJson} from '../wrapper-projection.js';
import {COMPOSITE_FONT_RESOURCE_V2,loadCompositeFontAssets} from './composite-font-assets.js';
import {renderCompositeRaster} from './composite-raster.js';
import {RecoveryCompositeRenderError} from './composite-render-errors.js';
import type {VerifiedBrandImage} from './contracts.js';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const RECOVERY_COMPOSITE_FONT_RESOURCE_SHA256_V2=hash(stableJson(COMPOSITE_FONT_RESOURCE_V2));
export function getRecoveryCompositeRuntimeIdentityV2(input:{profile:RecoveryCompositeProfile;profileSha256:string}) {
 readRecoveryCompositeProfile(input.profile,input.profileSha256,hash);
 const runtime=Object.freeze({schemaVersion:2,rendererVersion:'RECOVERY_COMPOSITE_V2',profileSha256:input.profileSha256,fontResourceSha256:RECOVERY_COMPOSITE_FONT_RESOURCE_SHA256_V2,platform:process.platform,architecture:process.arch,node:process.versions.node,libraries:Object.freeze({...sharp.versions}),dpi:72,rgba:true,wrap:'word',autoFit:false,trim:false,normalization:'NONE',background:'#ffffff',jpeg:Object.freeze({quality:86,mozjpeg:true,chromaSubsampling:'4:2:0'})});
 return Object.freeze({fontResourceSha256:RECOVERY_COMPOSITE_FONT_RESOURCE_SHA256_V2,runtimeSha256:hash(stableJson(runtime)),runtime});
}
export type RecoveryCompositeRenderInputV2={provenance:RecoveryCompositeProvenanceV2;logoBytes:Buffer;productBytes?:Buffer|null;signal?:AbortSignal};
export type RecoveryCompositeRenderedImageV2={image:VerifiedBrandImage;textBounds:Readonly<{width:number;height:number}>;profileSha256:string;fontResourceSha256:string;runtimeSha256:string};
export function createRecoveryCompositeImageRendererV2(options:{profile:RecoveryCompositeProfile;profileSha256:string;assetsDirectory?:URL}) {
 const profileSha256=options.profileSha256,profile=readRecoveryCompositeProfile(options.profile,profileSha256,hash),identity=getRecoveryCompositeRuntimeIdentityV2({profile,profileSha256});
 let assets:ReturnType<typeof loadCompositeFontAssets>|undefined;
 return {identity,async render(input:RecoveryCompositeRenderInputV2):Promise<RecoveryCompositeRenderedImageV2>{
  try{
   if(input.signal?.aborted)throw new RecoveryCompositeRenderError('MEDIA_DEADLINE');
   const provenance=RecoveryCompositeProvenanceV2Schema.parse(input.provenance);
   if(provenance.profileSha256!==profileSha256||stableJson(provenance.profile)!==stableJson(profile)||provenance.fontResourceSha256!==identity.fontResourceSha256||provenance.runtimeSha256!==identity.runtimeSha256)throw new RecoveryCompositeRenderError('SOURCE_IDENTITY_INVALID');
   assertRecoveryCompositeProvenanceIdentityV2(provenance,hash);assertRecoveryCompositeTextAllocationV2(profile,provenance.headerText);
   const rendered=await renderCompositeRaster(input,provenance,profile,{fontSize:profile.fontSize,spacing:profile.textLineSpacingPt},identity.runtime.jpeg,()=>assets??=loadCompositeFontAssets(options.assetsDirectory));
   return {...rendered,profileSha256,fontResourceSha256:identity.fontResourceSha256,runtimeSha256:identity.runtimeSha256};
  }catch(error){
   if(input.signal?.aborted)throw new RecoveryCompositeRenderError('MEDIA_DEADLINE');
   if(error instanceof RecoveryCompositeRenderError)throw error;
   throw new RecoveryCompositeRenderError('IMAGE_TRANSFORM_FAILED');
  }
 }};
}
