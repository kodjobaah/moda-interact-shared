import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {RecoveryCompositeProvenanceSchema,RECOVERY_COMPOSITE_LAYOUT_V1 as layout,type RecoveryCompositeProvenance} from '../composite-image.js';
import {stableJson} from '../wrapper-projection.js';
import type {VerifiedBrandImage} from './contracts.js';
import {loadCompositeFontAssets} from './composite-font-assets.js';
import {renderCompositeRaster} from './composite-raster.js';
import {RecoveryCompositeRenderError} from './composite-render-errors.js';
export {RecoveryCompositeRenderError} from './composite-render-errors.js';
export type {RecoveryCompositeRenderFailure} from './composite-render-errors.js';
export const RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256 = '9213e2b12cdc77c7de70ed5b738e1894efeae4b54657a31373236d2642065b02';
/** Freeze this receipt with the plan; replay never substitutes the current runtime identity. */
export const RECOVERY_COMPOSITE_RENDER_PROFILE = Object.freeze({
  schemaVersion:1, platform:process.platform, architecture:process.arch, node:process.versions.node,
  libraries:Object.freeze({...sharp.versions}), fontSize:44, dpi:72, rgba:true, wrap:'word',
  autoFit:false, trim:false, normalization:'NONE', background:'#ffffff',
  jpeg:Object.freeze({quality:86,mozjpeg:true,chromaSubsampling:'4:2:0'}),
});
export const RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256 = createHash('sha256').update(stableJson({
  assetManifestSha256:RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256,profile:RECOVERY_COMPOSITE_RENDER_PROFILE,
})).digest('hex');
export type RecoveryCompositeRenderInput = {provenance: RecoveryCompositeProvenance; logoBytes: Buffer; productBytes?: Buffer | null; signal?: AbortSignal};
export type RecoveryCompositeRenderedImage = {image: VerifiedBrandImage; textBounds: Readonly<{width: number; height: number}>; fontAssetSha256: string};
/** Frozen V1 adapter. Its literal geometry, font manifest, identity and encoding are preserved. */
export function createRecoveryCompositeImageRenderer(options:{assetsDirectory?:URL}={}) {
 let assets:ReturnType<typeof loadCompositeFontAssets>|undefined;
 return {async render(input:RecoveryCompositeRenderInput):Promise<RecoveryCompositeRenderedImage>{
  try{
   if(input.signal?.aborted)throw new RecoveryCompositeRenderError('MEDIA_DEADLINE');
   const provenance=RecoveryCompositeProvenanceSchema.parse(input.provenance);
   if(provenance.fontAssetSha256!==RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256)throw new RecoveryCompositeRenderError('FONT_UNAVAILABLE');
   const rendered=await renderCompositeRaster(input,provenance,{canvasWidth:layout.width,headerOnlyHeight:layout.headerHeight,withProductHeight:layout.headerHeight+layout.productHeight,...layout},{fontSize:RECOVERY_COMPOSITE_RENDER_PROFILE.fontSize},RECOVERY_COMPOSITE_RENDER_PROFILE.jpeg,()=>assets??=loadCompositeFontAssets(options.assetsDirectory));
   return {...rendered,fontAssetSha256:RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256};
  }catch(error){
   if(input.signal?.aborted)throw new RecoveryCompositeRenderError('MEDIA_DEADLINE');
   if(error instanceof RecoveryCompositeRenderError)throw error;
   throw new RecoveryCompositeRenderError('IMAGE_TRANSFORM_FAILED');
  }
 }};
}
