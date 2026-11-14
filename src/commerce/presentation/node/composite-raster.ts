import {createHash} from 'node:crypto';
import sharp,{type Sharp,type OverlayOptions} from 'sharp';
import {verifyEncodedBrandImage} from './metadata-verifier.js';
import {SHOP_BRAND_MAX_SOURCE_BYTES} from './contracts.js';
import {RecoveryCompositeRenderError,type RecoveryCompositeRenderFailure} from './composite-render-errors.js';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const fail=(code:RecoveryCompositeRenderFailure):never=>{throw new RecoveryCompositeRenderError(code);};
const check=(signal?:AbortSignal)=>{if(signal?.aborted)fail('MEDIA_DEADLINE');};
async function imageOperation(pipeline:Sharp,signal?:AbortSignal):Promise<Buffer>{
 check(signal);const abort=()=>pipeline.destroy();signal?.addEventListener('abort',abort,{once:true});
 try{const bytes=await pipeline.toBuffer();check(signal);return bytes;}finally{signal?.removeEventListener('abort',abort);}
}
export type CompositeRasterGeometry={canvasWidth:number;headerOnlyHeight:number;withProductHeight:number;logoLeft:number;logoTop:number;logoWidth:number;logoHeight:number;textLeft:number;textTop:number;textWidth:number;textHeight:number;productLeft:number;productTop:number;productWidth:number;productHeight:number};
export async function renderCompositeRaster(input:{logoBytes:Buffer;productBytes?:Buffer|null;signal?:AbortSignal},provenance:{headerText:string;logo:{contentSha256:string};product:{contentSha256:string}|null},geometry:CompositeRasterGeometry,typography:{fontSize:number;spacing:number},encoding:{quality:number;mozjpeg:boolean;chromaSubsampling:string},loadFont:()=>Promise<{fontfile:string;coverage:Set<number>}>) {
      if (!Buffer.isBuffer(input.logoBytes) || !input.logoBytes.length || input.logoBytes.length > SHOP_BRAND_MAX_SOURCE_BYTES || hash(input.logoBytes) !== provenance.logo.contentSha256 ||
          (provenance.product === null ? input.productBytes != null : !Buffer.isBuffer(input.productBytes) || !input.productBytes.length || input.productBytes.length > SHOP_BRAND_MAX_SOURCE_BYTES || hash(input.productBytes) !== provenance.product.contentSha256)) return fail('SOURCE_IDENTITY_INVALID');
      const font=await loadFont(); check(input.signal);
      if (Array.from(provenance.headerText).some(character => !['\n','\r','\t'].includes(character) && !font.coverage.has(character.codePointAt(0)!))) return fail('UNSUPPORTED_HEADER');
      const logoType = input.logoBytes.subarray(0, 2).toString('hex') === 'ffd8' ? 'image/jpeg' : input.logoBytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : null;
      if (!logoType || input.productBytes && input.productBytes.subarray(0,2).toString('hex') !== 'ffd8') return fail('SOURCE_IDENTITY_INVALID');
      await verifyEncodedBrandImage(input.logoBytes, logoType); check(input.signal);
      if (input.productBytes) { await verifyEncodedBrandImage(input.productBytes, 'image/jpeg'); check(input.signal); }
      const escaped = provenance.headerText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
      const textPipeline=sharp({text: {text: escaped, font: `DejaVu Sans ${typography.fontSize}`, fontfile: font.fontfile, width: geometry.textWidth, dpi: 72, rgba: true,spacing:typography.spacing}}).png();
      {const info=await textPipeline.metadata();check(input.signal);if(!info.width||!info.height||info.width*info.height>2_000_000||info.width>geometry.textWidth||info.height>geometry.textHeight)fail('HEADER_OVERFLOW');}
      const text=await imageOperation(textPipeline,input.signal);
      const bounds = await sharp(text).metadata(); check(input.signal);
      if (!bounds.width || !bounds.height || bounds.width > geometry.textWidth || bounds.height > geometry.textHeight) return fail('HEADER_OVERFLOW');
      const logo = await imageOperation(sharp(input.logoBytes, {limitInputPixels: 40_000_000, failOn: 'error'}).resize(geometry.logoWidth, geometry.logoHeight, {fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png(), input.signal);
      const overlays: OverlayOptions[] = [{input: logo,left:geometry.logoLeft,top:geometry.logoTop},{input:text,left:geometry.textLeft,top:geometry.textTop}];
      if (input.productBytes) {
        const product = await imageOperation(sharp(input.productBytes, {limitInputPixels:40_000_000,failOn:'error'}).resize(geometry.productWidth,geometry.productHeight,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png(), input.signal);
        overlays.push({input:product,left:geometry.productLeft,top:geometry.productTop});
      }
      const height=provenance.product===null?geometry.headerOnlyHeight:geometry.withProductHeight;
      const encoded = await imageOperation(sharp({create:{width:geometry.canvasWidth,height,channels:3,background:'#ffffff'}}).composite(overlays).removeAlpha().jpeg(encoding), input.signal);
      const image = await verifyEncodedBrandImage(encoded,'image/jpeg',{width:geometry.canvasWidth,height}); check(input.signal);

 return {image,textBounds:{width:bounds.width,height:bounds.height}};
}
