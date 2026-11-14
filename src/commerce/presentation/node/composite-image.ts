import {createHash} from 'node:crypto';
import {RecoveryCompositeProvenanceSchema,RecoveryPreparedCompositeImageSchema,RECOVERY_COMPOSITE_LAYOUT_V1 as layout,digestRecoveryCompositeRenderIdentity,type RecoveryCompositeProvenance,type RecoveryPreparedCompositeImage} from '../composite-image.js';
import type {ConversationPreparedBrandImage} from '../brand-image.js';
import type {ConversationPreparedProductImage} from '../product-image.js';
import {createRecoveryCompositeImageRenderer,type RecoveryCompositeRenderInput,type RecoveryCompositeRenderedImage} from './composite-renderer.js';
import type {ShopBrandR2Credentials,SafeFetcher,PublicMediaProbe} from './contracts.js';
import type {BrandR2Transport} from './r2-writer.js';
import {prepareCompositeImageCore} from './composite-preparation-core.js';
export type RecoveryCompositePreparationStage = 'CONFIGURATION' | 'SOURCE' | 'TRANSFORM' | 'R2' | 'PUBLIC_PROBE' | 'READY';
export type RecoveryCompositeOmission = 'CONFIGURATION_UNAVAILABLE' | 'UNSAFE_IMAGE_SOURCE' | 'SOURCE_UNAVAILABLE' | 'SOURCE_IDENTITY_INVALID' | 'FONT_UNAVAILABLE' | 'UNSUPPORTED_HEADER' | 'HEADER_OVERFLOW' | 'IMAGE_TRANSFORM_FAILED' | 'R2_UNAVAILABLE' | 'PUBLIC_IMAGE_UNAVAILABLE' | 'MEDIA_DEADLINE';
export type RecoveryCompositePreparationInput = {
  provenance: RecoveryCompositeProvenance; logo: ConversationPreparedBrandImage;
  product: {image: ConversationPreparedProductImage; platform:'SHOPIFY'|'WOOCOMMERCE'} | null;
  publicOrigin:string; bucketName:string; r2:ShopBrandR2Credentials; signal?:AbortSignal; deadlineAt?:number;
};
export type RecoveryCompositePreparationDependencies = {
  fetcher?:SafeFetcher; renderer?:{render(input:RecoveryCompositeRenderInput):Promise<RecoveryCompositeRenderedImage>};
  transportFactory?:(credentials:ShopBrandR2Credentials)=>BrandR2Transport; probe?:PublicMediaProbe; now?:()=>number;
};
export type RecoveryCompositePreparation = {kind:'READY';image:RecoveryPreparedCompositeImage;stage:'READY';durationMs:number;textBounds:Readonly<{width:number;height:number}>}
  | {kind:'OMITTED';reason:RecoveryCompositeOmission;stage:RecoveryCompositePreparationStage;durationMs:number};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
/** Frozen V1 adapter; shared orchestration does not select policy or alter old output identity. */
export function prepareRecoveryCompositeImage(input:RecoveryCompositePreparationInput,deps:RecoveryCompositePreparationDependencies={}):Promise<RecoveryCompositePreparation> {
 return prepareCompositeImageCore(input,deps,{
  namespace:'v1',parseProvenance:raw=>RecoveryCompositeProvenanceSchema.parse(raw),
  render:args=>(deps.renderer??createRecoveryCompositeImageRenderer()).render(args),
  dimensions:p=>({width:1125,height:p.product?900:300}),textLimits:()=>({width:layout.textWidth,height:layout.textHeight}),
  matches:(p,r)=>r.fontAssetSha256===p.fontAssetSha256,renderIdentity:p=>digestRecoveryCompositeRenderIdentity(p,hash),
  prepareOutput:raw=>RecoveryPreparedCompositeImageSchema.parse(raw),
 });
}
