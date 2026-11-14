import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {consumerProfileA as A,consumerProfileB as B,fixtureV2,hash} from './composite-v2.test-fixtures.js';
import {createRecoveryCompositeImageRendererV2,getRecoveryCompositeRuntimeIdentityV2} from './composite-renderer-v2.js';
import {prepareRecoveryCompositeImageV2,type RecoveryCompositePreparationInputV2,type RecoveryCompositePreparationDependenciesV2} from './composite-image-v2.js';
import {stableJson} from '../wrapper-projection.js';
import type {BrandR2Transport} from './r2-writer.js';
async function harness(profile=A,product=true){const f=await fixtureV2(profile,product),publicOrigin='https://media.example',logoKey=`shop-brands/shop.example/logo/sha256-${hash(f.logoBytes)}.jpg`,productKey=`conversation-products/v1/${hash('shop-1')}/${hash(stableJson({productId:'30',variantId:null}))}/${f.provenance.product?.contentSha256}.jpg`;
 const logo={schemaVersion:1 as const,origin:{...f.provenance.logo.origin,kind:'SHOP_BRAND' as const,role:'LOGO' as const},status:'READY' as const,kind:'R2_DERIVATIVE' as const,publicOrigin,publicUrl:`${publicOrigin}/${logoKey}`,objectKey:logoKey,contentSha256:hash(f.logoBytes),contentType:'image/jpeg' as const,sizeBytes:f.logoBytes.length,width:1125 as const,height:600 as const,verifiedAt:'2026-11-14T00:00:00Z'};
 const input:RecoveryCompositePreparationInputV2={profile,profileSha256:f.profileSha256,provenance:f.provenance,logo,product:product?{platform:'SHOPIFY',image:{schemaVersion:1,shopId:'shop-1',productId:'30',variantId:null,contentSha256:f.provenance.product!.contentSha256,publicUrl:`${publicOrigin}/${productKey}`,objectKey:productKey,contentType:'image/jpeg',byteLength:f.productBytes!.length,width:1125,height:600}}:null,publicOrigin,bucketName:'public-media',r2:{endpoint:'https://account.r2.cloudflarestorage.com',accessKeyId:'key-canary',secretAccessKey:'secret-canary'}};
 let puts=0,closes=0,fetches=0;let stored:Awaited<ReturnType<BrandR2Transport['head']>>|null=null;
 const port:BrandR2Transport={head:async()=>{if(!stored)throw {$metadata:{httpStatusCode:404}};return stored;},put:async p=>{puts++;stored={$metadata:{},ContentType:p.ContentType,ContentLength:p.ContentLength,Metadata:p.Metadata,CacheControl:p.CacheControl};},close:()=>{closes++;}};
 const deps:RecoveryCompositePreparationDependenciesV2={now:()=>10000,fetcher:{fetch:async url=>{fetches++;return {bytes:url===input.logo.publicUrl?f.logoBytes:f.productBytes!,declaredContentType:'image/jpeg'};}},transportFactory:()=>port,probe:{verify:async()=>{}}};return {...f,input,deps,port,counts:()=>({puts,closes,fetches})};}
test('same renderer code handles left and top/centered layouts with distinct dimensions/font/spacing/gap and deterministic pixels',async()=>{
 const hashes=[];
 for(const p of [A,B]){const f=await fixtureV2(p),renderer=createRecoveryCompositeImageRendererV2({profile:p,profileSha256:f.profileSha256}),rendered=await renderer.render(f),again=await renderer.render(f);
  assert.equal(rendered.image.contentSha256,again.image.contentSha256);assert.equal(rendered.image.width,p.canvasWidth);assert.equal(rendered.image.height,p.withProductHeight);
  const pixel=async(x:number,y:number)=>Array.from(await sharp(rendered.image.bytes).extract({left:x,top:y,width:1,height:1}).raw().toBuffer());
  const logo=await pixel(p.logoLeft+90,p.logoTop+90),photo=await pixel(p.productLeft+Math.floor(p.productWidth/2),p.productTop+Math.floor(p.productHeight/2));assert.ok(logo[0]>170&&logo[1]<50);assert.ok(photo[1]>130&&photo[0]<50);
  const text=await sharp(rendered.image.bytes).extract({left:p.textLeft,top:p.textTop,width:p.textWidth,height:p.textHeight}).raw().toBuffer();assert.ok(Array.from(text).filter(n=>n<100).length>100);
  const no=await fixtureV2(p,false);assert.equal((await renderer.render(no)).image.height,p.headerOnlyHeight);hashes.push(rendered.image.contentSha256);
 }
 assert.notEqual(hashes[0],hashes[1]);assert.notEqual(getRecoveryCompositeRuntimeIdentityV2({profile:A,profileSha256:(await fixtureV2(A)).profileSha256}).runtimeSha256,getRecoveryCompositeRuntimeIdentityV2({profile:B,profileSha256:(await fixtureV2(B)).profileSha256}).runtimeSha256);
});
test('V2 technical source/profile/glyph/overflow checks never choose another profile or shrink text',async()=>{
 const f=await fixtureV2(A,false),renderer=createRecoveryCompositeImageRendererV2({profile:A,profileSha256:f.profileSha256});
 await assert.rejects(renderer.render({...f,provenance:{...f.provenance,profile:B}}),{code:'SOURCE_IDENTITY_INVALID'});
 await assert.rejects(renderer.render({...f,provenance:{...f.provenance,headerText:'𠀀'}}),{code:'UNSUPPORTED_HEADER'});
 await assert.rejects(renderer.render({...f,provenance:{...f.provenance,headerText:'W'.repeat(500)}}));
 const bad=await harness(A);assert.equal((await prepareRecoveryCompositeImageV2({...bad.input,profile:B},bad.deps)).kind,'OMITTED');assert.equal(bad.counts().fetches,0);
 assert.equal((await prepareRecoveryCompositeImageV2({...bad.input,product:null},bad.deps)).kind,'OMITTED');assert.equal(bad.counts().puts,0);
});
test('V2 reuses the original single media budget, immutable storage/public probe and cleanup for both layouts',async()=>{
 for(const profile of [A,B]){const h=await harness(profile);const result=await prepareRecoveryCompositeImageV2(h.input,h.deps);assert.equal(result.kind,'READY');if(result.kind==='READY'){assert.equal(result.image.schemaVersion,2);assert.equal(result.image.height,profile.withProductHeight);assert.ok(result.image.objectKey.startsWith('conversation-composites/v2/'));}assert.deepEqual(h.counts(),{fetches:2,puts:1,closes:1});}
 const h=await harness(A,false),controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});h.deps.probe={verify:async()=>{entered();return new Promise(()=>{});}};const pending=prepareRecoveryCompositeImageV2({...h.input,signal:controller.signal},h.deps);await started;controller.abort();const result=await pending;assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'MEDIA_DEADLINE');assert.equal(h.counts().closes,1);
 const elapsed=await harness();let now=10000;elapsed.deps.now=()=>now;elapsed.deps.fetcher={fetch:async()=>{now=15001;return {bytes:elapsed.logoBytes,declaredContentType:'image/jpeg'};}};assert.equal((await prepareRecoveryCompositeImageV2(elapsed.input,elapsed.deps)).kind,'OMITTED');assert.equal(elapsed.counts().puts,0);
});

test('current preparer independently verifies sources/output and never uploads forged bytes',async()=>{
 for(const value of [{bytes:Buffer.from('forged'),declaredContentType:'image/jpeg'},{bytes:null,declaredContentType:'image/png'}]){const h=await harness(A,false);h.deps.fetcher={fetch:async()=>({...value,bytes:value.bytes??h.logoBytes})};const r=await prepareRecoveryCompositeImageV2(h.input,h.deps);assert.equal(r.kind,'OMITTED');if(r.kind==='OMITTED')assert.equal(r.reason,'SOURCE_IDENTITY_INVALID');assert.equal(h.counts().puts,0);}
 const h=await harness(A,false),rendered=await createRecoveryCompositeImageRendererV2({profile:A,profileSha256:h.profileSha256}).render(h);h.deps.renderer={render:async()=>({...rendered,image:{...rendered.image,contentSha256:'a'.repeat(64)}})};assert.equal((await prepareRecoveryCompositeImageV2(h.input,h.deps)).kind,'OMITTED');assert.equal(h.counts().puts,0);
});
test('current original deadline aborts every stage and late HEAD never starts PUT',async()=>{
 for(const stage of ['SOURCE','TRANSFORM','R2','PUBLIC_PROBE']){
 const h=await harness(A,false),controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const hang=async():Promise<never>=>{entered();return new Promise(()=>{});};
 if(stage==='SOURCE')h.deps.fetcher={fetch:hang};if(stage==='TRANSFORM')h.deps.renderer={render:hang};if(stage==='R2')h.deps.transportFactory=()=>({...h.port,head:hang});if(stage==='PUBLIC_PROBE')h.deps.probe={verify:hang};
 const pending=prepareRecoveryCompositeImageV2({...h.input,signal:controller.signal},h.deps);await started;controller.abort();const result=await pending;assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'MEDIA_DEADLINE');assert.equal(h.counts().closes,['R2','PUBLIC_PROBE'].includes(stage)?1:0);
 }
 const h=await harness(A,false),controller=new AbortController();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let puts=0;
 h.deps.transportFactory=()=>({...h.port,head:async()=>{entered();await gate;throw {$metadata:{httpStatusCode:404}};},put:async()=>{puts++;}});
 const pending=prepareRecoveryCompositeImageV2({...h.input,signal:controller.signal},h.deps);await started;controller.abort();assert.equal((await pending).kind,'OMITTED');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(puts,0);assert.equal(h.counts().closes,1);
});
test('current storage conflict and public proof failure remain safe omissions without secret leakage',async()=>{
 const h=await harness(A,false);h.deps.transportFactory=()=>({...h.port,head:async()=>({$metadata:{},ContentType:'image/jpeg',ContentLength:1,Metadata:{sha256:'a'.repeat(64)},CacheControl:'public, max-age=31536000, immutable'})});assert.equal((await prepareRecoveryCompositeImageV2(h.input,h.deps)).kind,'OMITTED');assert.equal(h.counts().puts,0);
 const p=await harness(A,false);p.deps.probe={verify:async()=>{throw Error('secret-canary');}};const result=await prepareRecoveryCompositeImageV2(p.input,p.deps);assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'PUBLIC_IMAGE_UNAVAILABLE');assert.equal(p.counts().closes,1);assert.ok(!JSON.stringify(result).includes('canary'));
});
