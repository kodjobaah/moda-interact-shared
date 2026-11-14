import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {ConversationPreparedBrandImageSchema,type ConversationBrandImageOrigin,type ConversationPreparedBrandImage} from '../brand-image.js';
import {ConversationPreparedProductImageSchema,type ConversationPreparedProductImage} from '../product-image.js';
import {stableJson} from '../wrapper-projection.js';
import type {VerifiedBrandImage} from './contracts.js';
import {ShopBrandMediaError} from './contracts.js';
import {RecoveryCompositeRenderError} from './composite-render-errors.js';
import {createSafeImageFetcher} from './safe-fetch.js';
import {createBrandR2S3Transport,putGuardedImmutableR2Object,isValidMediaBucket,type BrandR2Transport} from './r2-writer.js';
import {createShopBrandPublicMediaProbe} from './public-probe.js';
import {isPublicIpAddress} from './network-policy.js';
import {conversationProductObjectKey} from './product-image.js';
import {verifyEncodedBrandImage} from './metadata-verifier.js';
import type {RecoveryCompositePreparationInput,RecoveryCompositePreparationDependencies,RecoveryCompositePreparationStage,RecoveryCompositeOmission} from './composite-image.js';
export type CompositeCoreProvenance={shopId:string;logo:{origin:{kind:string;shopId:string;shopDomain:string;role:string;sourceGeneration:number;sourceFingerprint:string};contentSha256:string};product:{shopId:string;platform:string;productId:string;variantId:string|null;contentSha256:string}|null};
export type CompositeCoreRendered={image:VerifiedBrandImage;textBounds:Readonly<{width:number;height:number}>};
export type CompositeCoreResult<I>={kind:'READY';image:I;stage:'READY';durationMs:number;textBounds:Readonly<{width:number;height:number}>}|{kind:'OMITTED';reason:RecoveryCompositeOmission;stage:RecoveryCompositePreparationStage;durationMs:number};
export type CompositeCoreStrategy<P,R,I>={namespace:'v1'|'v2';parseProvenance(raw:unknown):P;render(input:{provenance:P;logoBytes:Buffer;productBytes:Buffer|null;signal?:AbortSignal}):Promise<R>;dimensions(p:P):{width:number;height:number};textLimits(p:P):{width:number;height:number};matches(p:P,rendered:R):boolean;renderIdentity(p:P):string;prepareOutput(raw:unknown):I;parseLogo?(raw:unknown):import('../brand-image.js').ConversationPreparedBrandImage;parseProduct?(raw:unknown):ConversationPreparedProductImage;productKey?(p:CompositeCoreProvenance['product']&{},image:ConversationPreparedProductImage):string};
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
class Deadline extends Error {}
function bounded<T>(operation:()=>Promise<T>,signal:AbortSignal):Promise<T> {
  if(signal.aborted)return Promise.reject(new Deadline());
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new Deadline());signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{if(signal.aborted)throw new Deadline();return operation();}).then(value=>{
      signal.removeEventListener('abort',abort);if(signal.aborted)reject(new Deadline());else resolve(value);
    },error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
function configuredOrigin(value:string):string|null {
  try {const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'');
    if(url.protocol!=='https:' || value!==url.origin || url.username || url.password || url.port || url.search || url.hash || host==='localhost' || host.endsWith('.localhost') || (isIP(host)&&!isPublicIpAddress(host)))return null;
    return url.origin;
  }catch{return null;}
}
export async function prepareCompositeImageCore<P extends CompositeCoreProvenance,R extends CompositeCoreRendered,I extends {publicUrl:string}>(input:Omit<RecoveryCompositePreparationInput,'provenance'>&{provenance:P},deps:Pick<RecoveryCompositePreparationDependencies,'fetcher'|'transportFactory'|'probe'|'now'>,strategy:CompositeCoreStrategy<P,R,I>,startedAt?:number):Promise<CompositeCoreResult<I>> {
  const now=deps.now??Date.now,start=startedAt??now();let stage:RecoveryCompositePreparationStage='CONFIGURATION';
  const duration=()=>{const elapsed=now()-start;return Number.isFinite(elapsed)?Math.max(0,Math.min(5000,elapsed)):0;};
  const omitted=(reason:RecoveryCompositeOmission):CompositeCoreResult<I>=>({kind:'OMITTED',reason,stage,durationMs:duration()});
  const budget=input.deadlineAt===undefined?5000:Math.min(5000,input.deadlineAt-start-1000);
  if(!Number.isFinite(start)||!Number.isFinite(budget)||budget<=0||input.signal?.aborted)return omitted('MEDIA_DEADLINE');
  const origin=configuredOrigin(input.publicOrigin);
  try {
    const endpoint=new URL(input.r2.endpoint);
    if(!origin||!isValidMediaBucket(input.bucketName)||!input.r2.accessKeyId||!input.r2.secretAccessKey||endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)return omitted('CONFIGURATION_UNAVAILABLE');
  }catch{return omitted('CONFIGURATION_UNAVAILABLE');}
  let parsed:P;try{parsed=strategy.parseProvenance(input.provenance);}catch{return omitted('UNSAFE_IMAGE_SOURCE');}
  const provenance={data:parsed};
  let logo:ReturnType<typeof ConversationPreparedBrandImageSchema.safeParse>;
  try{logo=strategy.parseLogo?{success:true,data:strategy.parseLogo(input.logo)}:ConversationPreparedBrandImageSchema.safeParse(input.logo);}catch{return omitted('UNSAFE_IMAGE_SOURCE');}
  if(!logo.success)return omitted('UNSAFE_IMAGE_SOURCE');
  if(stableJson(logo.data.origin)!==stableJson(provenance.data.logo.origin)||logo.data.contentSha256!==provenance.data.logo.contentSha256||logo.data.publicOrigin!==origin)return omitted('SOURCE_IDENTITY_INVALID');
  let product:ConversationPreparedProductImage|null=null;
  if(provenance.data.product===null) {if(input.product!==null)return omitted('SOURCE_IDENTITY_INVALID');}
  else {
    if(!input.product)return omitted('SOURCE_IDENTITY_INVALID');
    let p:ReturnType<typeof ConversationPreparedProductImageSchema.safeParse>;
    try{p=strategy.parseProduct?{success:true,data:strategy.parseProduct(input.product.image)}:ConversationPreparedProductImageSchema.safeParse(input.product.image);}catch{return omitted('SOURCE_IDENTITY_INVALID');}
    const expected=provenance.data.product;
    if(!p.success||input.product.platform!==expected.platform||p.data.shopId!==expected.shopId||p.data.productId!==expected.productId||p.data.variantId!==expected.variantId||p.data.contentSha256!==expected.contentSha256)return omitted('SOURCE_IDENTITY_INVALID');
    const expectedKey=strategy.productKey?strategy.productKey(expected,p.data):conversationProductObjectKey({kind:'SOURCE',shopId:expected.shopId,platform:expected.platform as 'SHOPIFY'|'WOOCOMMERCE',productId:expected.productId,variantId:expected.variantId,sourceUrl:p.data.publicUrl},expected.contentSha256);
    if(p.data.objectKey!==expectedKey||p.data.publicUrl!==`${origin}/${expectedKey}`)return omitted('SOURCE_IDENTITY_INVALID');
    product=p.data;
  }
  const controller=new AbortController(),abort=()=>controller.abort();input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted)abort();
  const timer=setTimeout(abort,budget),check=()=>{if(now()>=start+budget)abort();if(controller.signal.aborted)throw new Deadline();};
  let transport:BrandR2Transport|undefined;
  try {
    check();stage='SOURCE';const fetcher=deps.fetcher??createSafeImageFetcher({maxRedirects:0,maxBytes:5*1024*1024-1});
    const fetchSource=async(image:ConversationPreparedBrandImage|ConversationPreparedProductImage)=>{
      const fetched=await bounded(()=>fetcher.fetch(image.publicUrl,controller.signal),controller.signal);check();
      const length='sizeBytes'in image?image.sizeBytes:image.byteLength;
      if(fetched.declaredContentType!==image.contentType||fetched.bytes.length!==length||hash(fetched.bytes)!==image.contentSha256)throw new RecoveryCompositeRenderError('SOURCE_IDENTITY_INVALID');
      return fetched.bytes;
    };
    const logoBytes=await fetchSource(logo.data);check();
    const productBytes=product?await fetchSource(product):null;check();stage='TRANSFORM';
    const rendered=await bounded(()=>strategy.render({provenance:provenance.data,logoBytes,productBytes,signal:controller.signal}),controller.signal);check();
    // Re-decode final encoded output even when a host injects a renderer; preserve the old verifier default.
    const dimensions=strategy.dimensions(provenance.data),limits=strategy.textLimits(provenance.data);
    const verified=await bounded(()=>verifyEncodedBrandImage(rendered.image.bytes,'image/jpeg',dimensions),controller.signal);check();
    if(!Number.isSafeInteger(rendered.textBounds.width)||!Number.isSafeInteger(rendered.textBounds.height)||rendered.textBounds.width<=0||rendered.textBounds.height<=0||rendered.textBounds.width>limits.width||rendered.textBounds.height>limits.height||rendered.image.contentSha256!==verified.contentSha256||rendered.image.sizeBytes!==verified.sizeBytes||rendered.image.contentType!==verified.contentType||!strategy.matches(provenance.data,rendered))throw new RecoveryCompositeRenderError('IMAGE_TRANSFORM_FAILED');
    const tenantSha256=hash(provenance.data.shopId),renderIdentitySha256=strategy.renderIdentity(provenance.data);
    const objectKey=`conversation-composites/${strategy.namespace}/${tenantSha256}/${renderIdentitySha256}/${verified.contentSha256}.jpg`;
    const prepared=strategy.prepareOutput({schemaVersion:1,provenance:provenance.data,tenantSha256,renderIdentitySha256,publicOrigin:origin,publicUrl:`${origin}/${objectKey}`,objectKey,contentSha256:verified.contentSha256,contentType:verified.contentType,byteLength:verified.sizeBytes,width:verified.width,height:verified.height});
    stage='R2';transport=(deps.transportFactory??createBrandR2S3Transport)(input.r2);check();
    await bounded(()=>putGuardedImmutableR2Object({transportOrFactory:transport!,bucket:input.bucketName,objectKey,image:verified,expectedDimensions:dimensions,acceptsKey:key=>key===objectKey,signal:controller.signal}),controller.signal);check();
    stage='PUBLIC_PROBE';const probe=deps.probe??createShopBrandPublicMediaProbe(createSafeImageFetcher({maxRedirects:0,maxBytes:5*1024*1024-1}));
    await bounded(()=>probe.verify({url:prepared.publicUrl,image:verified},controller.signal),controller.signal);check();
    stage='READY';return {kind:'READY',image:prepared,stage,durationMs:duration(),textBounds:rendered.textBounds};
  }catch(error){
    if(controller.signal.aborted||error instanceof Deadline||now()>=start+budget)return omitted('MEDIA_DEADLINE');
    if(error instanceof RecoveryCompositeRenderError)return omitted(error.code);
    if(stage==='SOURCE')return omitted(error instanceof ShopBrandMediaError&&error.code==='UNSAFE_SOURCE'?'UNSAFE_IMAGE_SOURCE':'SOURCE_UNAVAILABLE');
    return omitted(stage==='TRANSFORM'?'IMAGE_TRANSFORM_FAILED':stage==='PUBLIC_PROBE'?'PUBLIC_IMAGE_UNAVAILABLE':'R2_UNAVAILABLE');
  }finally {clearTimeout(timer);input.signal?.removeEventListener('abort',abort);try{transport?.close?.();}catch{/* Cleanup cannot alter bounded outcome. */}}
}
