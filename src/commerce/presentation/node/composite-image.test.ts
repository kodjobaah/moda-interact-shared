import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,cp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {
 createRecoveryCompositeImageRenderer,RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256,RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256,RECOVERY_COMPOSITE_RENDER_PROFILE,
 prepareRecoveryCompositeImage,verifyEncodedBrandImage,SHOP_BRAND_CACHE_CONTROL,
 type RecoveryCompositePreparationInput,type RecoveryCompositePreparationDependencies,type BrandR2Transport,
} from './index.js';
import {
 stableJson,digestRecoveryCompositeRenderIdentity,buildRecoveryCompositeImagePlan,
 buildRecoveryCompositeMultipartDeliveryPlan,parseRecoveryCompositeMultipartDeliveryPlan,digestRecoveryCompositeMultipartDeliveryPlan,
 RecoveryCompositeMultipartDeliveryPlanSchema,RecoveryMultipartDeliveryPlanSchema,digestRecoveryMultipartDeliveryPlan,
 type RecoveryCompositeProvenance,
} from '../index.js';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const r2={endpoint:'https://account.r2.cloudflarestorage.com',accessKeyId:'key-canary',secretAccessKey:'secret-canary'};
async function fixture(product=true) {
 const logoBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#e00000'}}).jpeg().toBuffer();
 const productBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#00b020'}}).jpeg().toBuffer();
 const origin={kind:'SHOP_BRAND' as const,shopId:'shop-1',shopDomain:'shop.example',role:'LOGO' as const,sourceGeneration:1,sourceFingerprint:`sha256:${hash(logoBytes)}`};
 const provenance:RecoveryCompositeProvenance={schemaVersion:1,shopId:'shop-1',logo:{origin,contentSha256:hash(logoBytes)},product:product?{shopId:'shop-1',platform:'SHOPIFY',productId:'30',variantId:null,contentSha256:hash(productBytes)}:null,headerText:'Shop: Example\nWebsite: https://shop.example\n──────────\n',commonReferenceHash:'a'.repeat(64),layoutVersion:'RECOVERY_COMPOSITE_V1',rendererVersion:'RECOVERY_COMPOSITE_V1',fontAssetSha256:RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256};
 const publicOrigin='https://media.example',logoKey=`shop-brands/shop.example/logo/sha256-${hash(logoBytes)}.jpg`;
 const logo={schemaVersion:1 as const,origin,status:'READY' as const,kind:'R2_DERIVATIVE' as const,publicOrigin,objectKey:logoKey,publicUrl:`${publicOrigin}/${logoKey}`,contentSha256:hash(logoBytes),contentType:'image/jpeg' as const,sizeBytes:logoBytes.length,width:1125 as const,height:600 as const,verifiedAt:'2026-11-13T00:00:00Z'};
 const productKey=`conversation-products/v1/${hash('shop-1')}/${hash(stableJson({productId:'30',variantId:null}))}/${hash(productBytes)}.jpg`;
 const image={schemaVersion:1 as const,shopId:'shop-1',productId:'30',variantId:null,publicUrl:`${publicOrigin}/${productKey}`,objectKey:productKey,contentSha256:hash(productBytes),contentType:'image/jpeg' as const,byteLength:productBytes.length,width:1125 as const,height:600 as const};
 const input:RecoveryCompositePreparationInput={provenance,logo,product:product?{image,platform:'SHOPIFY'}:null,publicOrigin,bucketName:'public-media',r2};
 return {input,provenance,logoBytes,productBytes:product?productBytes:null};
}
async function harness(product=true) {
 const f=await fixture(product);let puts=0,closes=0,fetches=0,probes=0,renders=0;let stored:Awaited<ReturnType<BrandR2Transport['head']>>|null=null;
 const renderer=createRecoveryCompositeImageRenderer();
 const transport:BrandR2Transport={head:async()=>{if(!stored)throw {$metadata:{httpStatusCode:404}};return stored;},put:async value=>{puts++;stored={$metadata:{},ContentType:value.ContentType,ContentLength:value.ContentLength,Metadata:value.Metadata,CacheControl:value.CacheControl};},close:()=>{closes++;}};
 const deps:RecoveryCompositePreparationDependencies={now:()=>10000,fetcher:{fetch:async url=>{fetches++;return {bytes:url===f.input.logo.publicUrl?f.logoBytes:f.productBytes!,declaredContentType:'image/jpeg'};}},renderer:{render:async input=>{renders++;return renderer.render(input);}},transportFactory:()=>transport,probe:{verify:async()=>{probes++;}}};
 return {...f,deps,transport,counts:()=>({puts,closes,fetches,probes,renders})};
}
test('real fixed compositor is deterministic, contains unchanged inputs and paints header/logo/product pixels',async()=>{
 const f=await fixture(),renderer=createRecoveryCompositeImageRenderer(),original=Buffer.from(f.logoBytes);
 const a=await renderer.render(f),b=await renderer.render(f);assert.equal(a.image.contentSha256,b.image.contentSha256);assert.deepEqual(f.logoBytes,original);
 assert.equal(a.image.width,1125);assert.equal(a.image.height,900);assert.ok(a.textBounds.height<=252);assert.ok(a.textBounds.width<=813);
 const pixel=async(x:number,y:number)=>Array.from(await sharp(a.image.bytes).extract({left:x,top:y,width:1,height:1}).raw().toBuffer());
 const logo=await pixel(138,150),product=await pixel(562,600),gap=await pixel(48,276);
 assert.ok(logo[0]>180&&logo[1]<40);assert.ok(product[1]>120&&product[0]<40);assert.ok(gap.every(v=>v>240));
 const text=await sharp(a.image.bytes).extract({left:264,top:24,width:813,height:252}).raw().toBuffer();assert.ok(Array.from(text).filter(v=>v<100).length>100);
 const no=await fixture(false),header=await renderer.render(no);assert.equal(header.image.height,300);
 const changed={...f,provenance:{...f.provenance,headerText:'Different name\nhttps://shop.example\n──────────\n'}};
 assert.notEqual((await renderer.render(changed)).image.contentSha256,a.image.contentSha256);
 assert.notEqual(digestRecoveryCompositeRenderIdentity(changed.provenance,hash),digestRecoveryCompositeRenderIdentity(f.provenance,hash));
 assert.equal(RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256,hash(stableJson({assetManifestSha256:RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256,profile:RECOVERY_COMPOSITE_RENDER_PROFILE})));
});
test('glyph coverage, escaped markup, overflow, source identity and missing/tampered font fail closed',async()=>{
 const f=await fixture(false),renderer=createRecoveryCompositeImageRenderer();
 for(const headerText of ['Café München £ ──\nhttps://shop.example\n','<b>Literal & shop</b>\nhttps://shop.example\n'])assert.ok((await renderer.render({...f,provenance:{...f.provenance,headerText}})).textBounds.width>0);
 for(const headerText of ['𠀀\nhttps://shop.example\n','🧐\nhttps://shop.example\n'])await assert.rejects(renderer.render({...f,provenance:{...f.provenance,headerText}}),{code:'UNSUPPORTED_HEADER'});
 await assert.rejects(renderer.render({...f,provenance:{...f.provenance,headerText:'W'.repeat(500)}}),{code:'HEADER_OVERFLOW'});
 await assert.rejects(renderer.render({...f,logoBytes:Buffer.from('not-image')}),{code:'SOURCE_IDENTITY_INVALID'});
 const svg=Buffer.from('<svg><image href="https://127.0.0.1/private"/></svg>');await assert.rejects(renderer.render({...f,logoBytes:svg,provenance:{...f.provenance,logo:{...f.provenance.logo,contentSha256:hash(svg)}}}),{code:'SOURCE_IDENTITY_INVALID'});
 await assert.rejects(renderer.render({...f,provenance:{...f.provenance,fontAssetSha256:'a'.repeat(64)}}),{code:'FONT_UNAVAILABLE'});
 await assert.rejects(createRecoveryCompositeImageRenderer({assetsDirectory:new URL('file:///missing-shared010-font/')}).render(f),{code:'FONT_UNAVAILABLE'});
 const dir=await mkdtemp(join(tmpdir(),'composite-font-'));try{await cp(new URL('../../../../assets/recovery-composite/',import.meta.url),dir,{recursive:true});await writeFile(join(dir,'DejaVuSans.ttf'),'tampered');await assert.rejects(createRecoveryCompositeImageRenderer({assetsDirectory:new URL('file://'+dir+'/')}).render(f),{code:'FONT_UNAVAILABLE'});}finally{await rm(dir,{recursive:true,force:true});}
 const controller=new AbortController();controller.abort();await assert.rejects(renderer.render({...f,signal:controller.signal}),{code:'MEDIA_DEADLINE'});
});
test('explicit composite verification dimensions preserve strict old 1125x600 defaults',async()=>{
 const f=await fixture(false),rendered=await createRecoveryCompositeImageRenderer().render(f);
 await assert.rejects(verifyEncodedBrandImage(rendered.image.bytes,'image/jpeg'),{code:'OUTPUT_VERIFICATION_FAILED'});
 assert.equal((await verifyEncodedBrandImage(rendered.image.bytes,'image/jpeg',{width:1125,height:300})).contentSha256,rendered.image.contentSha256);
 assert.equal((await verifyEncodedBrandImage(f.logoBytes,'image/jpeg')).height,600);
 await assert.rejects(verifyEncodedBrandImage(f.logoBytes,'image/jpeg',{width:Infinity,height:1}));
});
test('preparer verifies both sources/output then immutable storage/probe; HEAD reuses writes after rerender',async()=>{
 const h=await harness();for(let i=0;i<2;i++){const result=await prepareRecoveryCompositeImage(h.input,h.deps);assert.equal(result.kind,'READY');if(result.kind==='READY'){assert.equal(result.image.height,900);assert.equal(result.image.provenance.product?.productId,'30');assert.ok(result.image.publicUrl.startsWith('https://media.example/conversation-composites/v1/'));assert.ok(!JSON.stringify(result).includes('canary'));}}
 assert.deepEqual(h.counts(),{puts:1,closes:2,fetches:4,probes:2,renders:2});
 const no=await harness(false);assert.equal((await prepareRecoveryCompositeImage(no.input,no.deps)).kind,'READY');assert.equal(no.counts().fetches,1);
});
test('missing selected product never downgrades to header-only, and unsafe identity/config skips all I/O',async()=>{
 const h=await harness();
 for(const input of [{...h.input,product:null},{...h.input,product:{...h.input.product!,image:{...h.input.product!.image,publicUrl:'https://127.0.0.1/product.jpg'}}},{...h.input,provenance:{...h.provenance,shopId:'foreign'}},{...h.input,publicOrigin:'https://127.0.0.1'},{...h.input,r2:{...r2,secretAccessKey:''}}])assert.equal((await prepareRecoveryCompositeImage(input,h.deps)).kind,'OMITTED');
 assert.equal(h.counts().fetches,0);
 const p=await harness();let fetches=0;p.deps.fetcher={fetch:async()=>{if(++fetches===2)throw Error('private-canary');return {bytes:p.logoBytes,declaredContentType:'image/jpeg'};}};
 const result=await prepareRecoveryCompositeImage(p.input,p.deps);assert.equal(result.kind,'OMITTED');assert.equal(p.counts().puts,0);assert.ok(!JSON.stringify(result).includes('canary'));
});
test('source bytes/type/length and injected output metadata are verified independently',async()=>{
 for(const value of [{bytes:Buffer.from('forged'),declaredContentType:'image/jpeg'}, {bytes:null,declaredContentType:'image/png'}]){const h=await harness(false);h.deps.fetcher={fetch:async()=>({...value,bytes:value.bytes??h.logoBytes})};const r=await prepareRecoveryCompositeImage(h.input,h.deps);assert.equal(r.kind,'OMITTED');if(r.kind==='OMITTED')assert.equal(r.reason,'SOURCE_IDENTITY_INVALID');assert.equal(h.counts().puts,0);}
 const h=await harness(false),rendered=await createRecoveryCompositeImageRenderer().render(h);h.deps.renderer={render:async()=>({...rendered,image:{...rendered.image,contentSha256:'a'.repeat(64)}})};assert.equal((await prepareRecoveryCompositeImage(h.input,h.deps)).kind,'OMITTED');assert.equal(h.counts().puts,0);
});
test('single original optional budget spans both sources and every later stage; caller abort closes transport',async()=>{
 for(const stage of ['SOURCE','TRANSFORM','R2','PUBLIC_PROBE']){
  const h=await harness(false),controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const hang=async():Promise<never>=>{entered();return new Promise(()=>{});};
  if(stage==='SOURCE')h.deps.fetcher={fetch:hang};if(stage==='TRANSFORM')h.deps.renderer={render:hang};if(stage==='R2')h.deps.transportFactory=()=>({...h.transport,head:hang});if(stage==='PUBLIC_PROBE')h.deps.probe={verify:hang};
  const pending=prepareRecoveryCompositeImage({...h.input,signal:controller.signal},h.deps);await started;controller.abort();const result=await pending;assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'MEDIA_DEADLINE');assert.equal(h.counts().closes,['R2','PUBLIC_PROBE'].includes(stage)?1:0);
 }
 const h=await harness();let clock=10000,fetches=0;h.deps.now=()=>clock;h.deps.fetcher={fetch:async()=>{fetches++;clock=15000;return {bytes:h.logoBytes,declaredContentType:'image/jpeg'};}};assert.equal((await prepareRecoveryCompositeImage(h.input,h.deps)).kind,'OMITTED');assert.equal(fetches,1);assert.equal(h.counts().renders,0);
 const short=await harness(false);short.deps.fetcher={fetch:async()=>new Promise(()=>{})};const result=await prepareRecoveryCompositeImage({...short.input,deadlineAt:11001},short.deps);assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'MEDIA_DEADLINE');
});
test('R2 conflict and public probe mismatch refuse READY without overwrite or secret leakage',async()=>{
 const h=await harness(false);h.deps.transportFactory=()=>({...h.transport,head:async()=>({$metadata:{},ContentType:'image/jpeg',ContentLength:1,Metadata:{sha256:'a'.repeat(64)},CacheControl:SHOP_BRAND_CACHE_CONTROL})});const collision=await prepareRecoveryCompositeImage(h.input,h.deps);assert.equal(collision.kind,'OMITTED');assert.equal(h.counts().puts,0);
 const p=await harness(false);p.deps.probe={verify:async()=>{throw Error('secret-canary https://private.example/?token=key-canary');}};const result=await prepareRecoveryCompositeImage(p.input,p.deps);assert.equal(result.kind,'OMITTED');if(result.kind==='OMITTED')assert.equal(result.reason,'PUBLIC_IMAGE_UNAVAILABLE');assert.equal(p.counts().closes,1);assert.ok(!JSON.stringify(result).includes('canary'));
});
test('new recovery reader admits exactly one composite HEADER with independent trusted context; old bytes remain exact',async()=>{
 const h=await harness(false),prepared=await prepareRecoveryCompositeImage(h.input,h.deps);assert.equal(prepared.kind,'READY');if(prepared.kind!=='READY')return;
 const answerText='Complete answer includes https://shop.example/recover',footerText='\n──────────\nhttps://shop.example/recover',checkoutUrl='https://shop.example/recover';
 const trusted={provenance:h.provenance,publicOrigin:h.input.publicOrigin,answerText,footerText,logicalBody:h.provenance.headerText+answerText+footerText,checkoutUrl,output:{contentSha256:prepared.image.contentSha256,byteLength:prepared.image.byteLength}};
 const plan=buildRecoveryCompositeImagePlan({image:prepared.image,trusted},hash),carrier=buildRecoveryCompositeMultipartDeliveryPlan({plan,trusted},hash);
 assert.deepEqual(parseRecoveryCompositeMultipartDeliveryPlan(carrier,{checkoutUrl,composite:trusted},hash),carrier);
 assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(carrier).success,false);
 for(const parts of [[...carrier.parts,...carrier.parts],[{role:'PRODUCT',plan}],[{role:'ANSWER',plan}], [...carrier.parts,{role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:answerText+footerText}}]])assert.equal(RecoveryCompositeMultipartDeliveryPlanSchema.safeParse({...carrier,parts}).success,false);
 assert.throws(()=>parseRecoveryCompositeMultipartDeliveryPlan(carrier,{checkoutUrl,composite:null},hash));
 assert.throws(()=>parseRecoveryCompositeMultipartDeliveryPlan(carrier,{checkoutUrl,composite:{...trusted,answerText:'Forged'}},hash));
 const old={schemaVersion:1 as const,kind:'RECOVERY_MULTIPART' as const,parts:[{role:'ANSWER' as const,plan:{schemaVersion:1 as const,kind:'TEXT' as const,body:answerText+footerText}}]};
 assert.deepEqual(parseRecoveryCompositeMultipartDeliveryPlan(old,{checkoutUrl,composite:null},hash),old);assert.equal(digestRecoveryCompositeMultipartDeliveryPlan(old,hash),digestRecoveryMultipartDeliveryPlan(old,hash));
});

test('late noncooperative storage HEAD cannot start PUT after the preparation has aborted',async()=>{
 const h=await harness(false),controller=new AbortController();let entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});let puts=0;
 h.deps.transportFactory=()=>({...h.transport,head:async()=>{entered();await gate;throw {$metadata:{httpStatusCode:404}};},put:async()=>{puts++;}});
 const pending=prepareRecoveryCompositeImage({...h.input,signal:controller.signal},h.deps);await started;controller.abort();
 assert.equal((await pending).kind,'OMITTED');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(puts,0);assert.equal(h.counts().closes,1);
});
