import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';
import {
 createSafeImageFetcher, createShopBrandPublicMediaProbe, createOutreachProductImageTransformer,
 createShopBrandImageTransformer, ShopBrandMediaError, isPublicIpAddress,
 putGuardedImmutableR2Object, SHOP_BRAND_CACHE_CONTROL, prepareConversationProductImage,
 conversationProductObjectKey, sanitizeR2ProviderMessage,
 type VerifiedBrandImage, type BrandR2Transport, type ImageHttpResponse, type ConversationProductImagePreparationDependencies,
} from './index.js';
import type { ConversationProductImageSource } from '../product-image.js';
import { stableJson } from '../wrapper-projection.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const golden=JSON.parse(readFileSync(new URL('./transform-golden.json',import.meta.url),'utf8')) as {svg:string;records:Array<Omit<VerifiedBrandImage,'bytes'>&{role:'PRODUCT'|'LOGO'|'SQUARE_LOGO'|'COVER_IMAGE'}>};
const source:ConversationProductImageSource={kind:'SOURCE',shopId:'shop-A',platform:'WOOCOMMERCE',productId:'30',variantId:null,sourceUrl:'https://merchant.example/tree?token=secret-canary'};
const r2={endpoint:'https://account.r2.cloudflarestorage.com',accessKeyId:'key-canary',secretAccessKey:'secret-canary'};
const input={source,publicOrigin:'https://media.example',bucketName:'public-media',r2};
const response=(statusCode=200,headers:ImageHttpResponse['headers']={},bytes=Buffer.from('fixture'),peerAddress='8.8.8.8'):ImageHttpResponse=>({statusCode,headers,body:Readable.from([bytes]),peerAddress});
test('relocated product and every brand preset preserve original encoded bytes and metadata',async()=>{
 for(const expected of golden.records){
  const actual=expected.role==='PRODUCT'?await createOutreachProductImageTransformer().transform(Buffer.from(golden.svg)):await createShopBrandImageTransformer().transform(Buffer.from(golden.svg),expected.role);
  const {bytes,...metadata}=actual;const {role,...wanted}=expected;assert.deepEqual(metadata,wanted,role);assert.equal(hash(bytes),expected.contentSha256);
 }
 for(const svg of ['<svg width="8000" height="6000" xmlns="http://www.w3.org/2000/svg"/>','<svg width="10" height="10"><image href="https://private.example/a"/></svg>'])await assert.rejects(createOutreachProductImageTransformer().transform(Buffer.from(svg)),ShopBrandMediaError);
 const controller=new AbortController();controller.abort();await assert.rejects(createOutreachProductImageTransformer().transform(Buffer.from(golden.svg),controller.signal),{code:'SOURCE_TIMEOUT'});
});
test('same DNS/private/metadata/IPv6 defenses run before each request and redirect',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','fc00::1','::ffff:127.0.0.1']){
  assert.equal(isPublicIpAddress(address),false);let calls=0;
  const fetcher=createSafeImageFetcher({resolveAll:async()=>[{address,family:address.includes(':')?6:4}],request:async()=>{calls++;return response();}});
  await assert.rejects(fetcher.fetch('https://merchant.example/a'),{code:'UNSAFE_SOURCE'});assert.equal(calls,0);
 }
 let calls=0;const fetcher=createSafeImageFetcher({resolveAll:async()=>[{address:'8.8.8.8',family:4}],request:async request=>{calls++;assert.equal(request.address.address,'8.8.8.8');return response(302,{location:'https://127.0.0.1/private'});}});
 await assert.rejects(fetcher.fetch('https://merchant.example/a'),{code:'UNSAFE_SOURCE'});assert.equal(calls,1);
 const rebound=createSafeImageFetcher({resolveAll:async()=>[{address:'8.8.8.8',family:4}],request:async()=>response(200,{},Buffer.from('x'),'127.0.0.1')});await assert.rejects(rebound.fetch('https://merchant.example/a'),{code:'UNSAFE_SOURCE'});
});
test('redirect, source size/encoding, and no-redirect public probe bounds remain',async()=>{
 for(const [headers,bytes,code] of [[{'content-encoding':'gzip'},Buffer.from('x'),'UNSUPPORTED_ENCODING'],[{'content-length':'99'},Buffer.from('x'),'SOURCE_TOO_LARGE'],[{},Buffer.from('four'),'SOURCE_TOO_LARGE']] as const){
  const fetcher=createSafeImageFetcher({maxBytes:3,resolveAll:async()=>[{address:'8.8.8.8',family:4}],request:async()=>response(200,headers,bytes)});await assert.rejects(fetcher.fetch('https://merchant.example/a'),{code});
 }
 let calls=0;const redirects=createSafeImageFetcher({resolveAll:async()=>[{address:'8.8.8.8',family:4}],request:async()=>{calls++;return response(302,{location:'/again'});}});await assert.rejects(redirects.fetch('https://merchant.example/a'),{code:'UNSAFE_SOURCE'});assert.equal(calls,4);
 let probeCalls=0;const fetcher=createSafeImageFetcher({maxRedirects:0,resolveAll:async()=>[{address:'8.8.8.8',family:4}],request:async()=>{probeCalls++;return response(302,{location:'/other'});}});
 const image=await createOutreachProductImageTransformer().transform(Buffer.from(golden.svg));await assert.rejects(createShopBrandPublicMediaProbe(fetcher).verify({url:'https://media.example/key.jpg',image}),{code:'PUBLIC_MEDIA_UNAVAILABLE'});assert.equal(probeCalls,1);
});
function transport(image:VerifiedBrandImage){
 let stored=false,puts=0,closes=0,conflict=false;
 const port:BrandR2Transport={head:async()=>{if(!stored)throw {$metadata:{httpStatusCode:404}};return {$metadata:{},ContentType:image.contentType,ContentLength:image.sizeBytes,Metadata:{sha256:conflict?'0'.repeat(64):image.contentSha256},CacheControl:SHOP_BRAND_CACHE_CONTROL};},put:async value=>{assert.equal(value.IfNoneMatch,'*');assert.equal(value.CacheControl,SHOP_BRAND_CACHE_CONTROL);assert.equal(value.Metadata?.sha256,image.contentSha256);stored=true;puts++;},close:()=>{closes++;}};
 return {port,get puts(){return puts;},get closes(){return closes;},set conflict(value:boolean){stored=true;conflict=value;}};
}
test('relocated immutable writer reuses identical objects, refuses collision and never overwrites',async()=>{
 const image=await createOutreachProductImageTransformer().transform(Buffer.from(golden.svg));const t=transport(image),objectKey=conversationProductObjectKey(source,image.contentSha256);
 assert.equal(objectKey,`conversation-products/v1/${hash(source.shopId)}/${hash(stableJson({productId:source.productId,variantId:source.variantId}))}/${image.contentSha256}.jpg`);
 for(let i=0;i<2;i++)await putGuardedImmutableR2Object({transportOrFactory:t.port,bucket:'public-media',objectKey,image,acceptsKey:()=>true});assert.equal(t.puts,1);
 t.conflict=true;await assert.rejects(putGuardedImmutableR2Object({transportOrFactory:t.port,bucket:'public-media',objectKey,image,acceptsKey:()=>true}),{code:'R2_OBJECT_MISMATCH'});assert.equal(t.puts,1);
 const safe=sanitizeR2ProviderMessage(new Error('secret-canary key-canary https://merchant.example/?token=secret-canary'),r2);assert.ok(!safe?.includes('canary')&&!safe?.includes('https://'));
});
async function harness(){
 const image=await createOutreachProductImageTransformer().transform(Buffer.from(golden.svg)),t=transport(image);let fetched=0,transformed=0,probed=0;
 const deps:ConversationProductImagePreparationDependencies={now:()=>10000,fetcher:{fetch:async()=>{fetched++;return {bytes:Buffer.from(golden.svg),declaredContentType:'image/svg+xml'};}},transformer:{transform:async()=>{transformed++;return image;}},transportFactory:()=>t.port,probe:{verify:async()=>{probed++;}}};
 return {image,t,deps,counts:()=>({fetched,transformed,probed})};
}
test('one coordinator attempt returns only public verified image metadata and closes its transport',async()=>{
 const h=await harness();const result=await prepareConversationProductImage(input,h.deps);assert.equal(result.kind,'READY');if(result.kind!=='READY')return;
 assert.equal(result.image.publicUrl,`${input.publicOrigin}/${conversationProductObjectKey(source,h.image.contentSha256)}`);assert.equal(result.image.variantId,null);assert.equal(h.t.puts,1);assert.equal(h.t.closes,1);assert.deepEqual(h.counts(),{fetched:1,transformed:1,probed:1});assert.ok(!JSON.stringify(result).includes('canary'));
});
test('configuration and exhausted budget skip all I/O; failures are bounded omissions without secrets',async()=>{
 for(const cfg of [{...input,publicOrigin:'http://media.example'},{...input,bucketName:''},{...input,r2:{...r2,secretAccessKey:''}}]){const h=await harness();const result=await prepareConversationProductImage(cfg,h.deps);assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'CONFIGURATION_UNAVAILABLE');assert.equal(h.counts().fetched,0);}
 const h=await harness();const exhausted=await prepareConversationProductImage({...input,deadlineAt:11000},h.deps);assert.equal(exhausted.kind,'OMITTED');if(exhausted.kind==='OMITTED')assert.equal(exhausted.reason,'MEDIA_DEADLINE');assert.equal(h.counts().fetched,0);
 for(const stage of ['SOURCE','TRANSFORM','R2','PUBLIC_PROBE'] as const){
  const h=await harness(),bad=async()=>{throw new Error('secret-canary https://private.example/?token=key-canary');};
  if(stage==='SOURCE')h.deps.fetcher={fetch:bad};if(stage==='TRANSFORM')h.deps.transformer={transform:bad};if(stage==='R2')h.deps.transportFactory=()=>{throw new Error('secret-canary');};if(stage==='PUBLIC_PROBE')h.deps.probe={verify:bad};
  const result=await prepareConversationProductImage(input,h.deps);assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,{SOURCE:'SOURCE_UNAVAILABLE',TRANSFORM:'IMAGE_TRANSFORM_FAILED',R2:'R2_UNAVAILABLE',PUBLIC_PROBE:'PUBLIC_IMAGE_UNAVAILABLE'}[stage]);assert.ok(!JSON.stringify(result).includes('canary'));assert.equal(h.t.closes,stage==='PUBLIC_PROBE'?1:0);
 }
 const unsafe=await harness();unsafe.deps.fetcher={fetch:async()=>{throw new ShopBrandMediaError('UNSAFE_SOURCE');}};assert.equal((await prepareConversationProductImage(input,unsafe.deps) as {reason:string}).reason,'UNSAFE_IMAGE_SOURCE');
});
test('caller abort bounds every stage, including noncooperative ports, and prevents later I/O',async()=>{
 for(const stage of ['SOURCE','TRANSFORM','R2','PUBLIC_PROBE'] as const){
  const h=await harness(),controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  const hang=async():Promise<never>=>{entered();return new Promise(()=>{});};
  if(stage==='SOURCE')h.deps.fetcher={fetch:hang};if(stage==='TRANSFORM')h.deps.transformer={transform:hang};if(stage==='R2')h.deps.transportFactory=()=>({...h.t.port,head:hang});if(stage==='PUBLIC_PROBE')h.deps.probe={verify:hang};
  const pending=prepareConversationProductImage({...input,signal:controller.signal},h.deps);await started;controller.abort();const result=await pending;assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'MEDIA_DEADLINE');await immediate();assert.equal(h.t.closes,['R2','PUBLIC_PROBE'].includes(stage)?1:0);if(stage!=='PUBLIC_PROBE')assert.equal(h.counts().probed,0);
 }
 const h=await harness();h.deps.fetcher={fetch:async()=>new Promise(()=>{})};const expired=await prepareConversationProductImage({...input,deadlineAt:11001},h.deps);assert.equal((expired as {reason:string}).reason,'MEDIA_DEADLINE');
});

test('coordinator uses the relocated real product preset/probe and observes injected-clock budget between stages',async()=>{
 const h=await harness();delete h.deps.transformer;
 h.deps.probe=createShopBrandPublicMediaProbe({fetch:async()=>({bytes:h.image.bytes,declaredContentType:'image/jpeg'})});
 const result=await prepareConversationProductImage(input,h.deps);assert.equal(result.kind,'READY');if(result.kind==='READY')assert.equal(result.image.contentSha256,h.image.contentSha256);
 const expired=await harness();let clock=10000;expired.deps.now=()=>clock;expired.deps.fetcher={fetch:async()=>{clock=15001;return {bytes:Buffer.from(golden.svg),declaredContentType:null};}};
 const omitted=await prepareConversationProductImage(input,expired.deps);assert.equal((omitted as {reason:string}).reason,'MEDIA_DEADLINE');assert.equal(expired.counts().transformed,0);assert.equal(expired.t.puts,0);
 const controller=new AbortController();const transforming=createOutreachProductImageTransformer().transform(Buffer.from(golden.svg),controller.signal);controller.abort();await assert.rejects(transforming,{code:'SOURCE_TIMEOUT'});
});
test('immutable PUT races reuse only matching HEAD and public hash/type mismatch fails closed',async()=>{
 const image=await createOutreachProductImageTransformer().transform(Buffer.from(golden.svg));
 for(const status of [409,412]){
  let heads=0,puts=0;
  const port:BrandR2Transport={head:async()=>{if(++heads===1)throw {$metadata:{httpStatusCode:404}};return {$metadata:{},ContentType:image.contentType,ContentLength:image.sizeBytes,Metadata:{sha256:image.contentSha256},CacheControl:SHOP_BRAND_CACHE_CONTROL};},put:async()=>{puts++;throw {$metadata:{httpStatusCode:status}};}};
  await putGuardedImmutableR2Object({transportOrFactory:port,bucket:'public-media',objectKey:conversationProductObjectKey(source,image.contentSha256),image,acceptsKey:()=>true});assert.equal(puts,1);assert.equal(heads,2);
 }
 for(const fetched of [{bytes:Buffer.from('changed'),declaredContentType:'image/jpeg'},{bytes:image.bytes,declaredContentType:'image/png'}])await assert.rejects(createShopBrandPublicMediaProbe({fetch:async()=>fetched}).verify({url:'https://media.example/key.jpg',image}),{code:'PUBLIC_MEDIA_MISMATCH'});
});

test('a slow transport factory cannot start storage I/O after the remaining budget',async()=>{
 const h=await harness();let clock=10000,heads=0;h.deps.now=()=>clock;
 h.deps.transportFactory=()=>{clock=15001;return {...h.t.port,head:async()=>{heads++;throw Error('must not run');}};};
 const result=await prepareConversationProductImage(input,h.deps);assert.equal((result as {reason:string}).reason,'MEDIA_DEADLINE');assert.equal(heads,0);assert.equal(h.t.closes,1);
});
