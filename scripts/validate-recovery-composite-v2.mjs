import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import vm from 'node:vm';
const artifact=process.argv[2]&&resolve(process.argv[2]);assert.ok(artifact,'Pass exact candidate tarball');
const root=await mkdtemp(join(tmpdir(),'composite-v2-package-'));
try{
 await writeFile(join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',artifact],{cwd:root,stdio:'pipe'});
 const smoke=`
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as c from '@modainteract/moda-interact-shared/commerce/presentation';
import * as n from '@modainteract/moda-interact-shared/commerce/presentation/node';
const hash=v=>createHash('sha256').update(v).digest('hex');
// These are independent consumer TEST inputs, not package-owned operational defaults.
const A={schemaVersion:1,fontId:'DEJAVU_SANS_2_37',canvasWidth:1125,headerOnlyHeight:300,withProductHeight:900,logoLeft:48,logoTop:60,logoWidth:180,logoHeight:180,textLeft:264,textTop:24,textWidth:813,textHeight:252,fontSize:44,textLineSpacingPt:0,productLeft:0,productTop:300,productWidth:1125,productHeight:600};
const B={...A,headerOnlyHeight:640,withProductHeight:1280,logoLeft:472,logoTop:24,textLeft:90,textTop:250,textWidth:945,textHeight:360,fontSize:40,textLineSpacingPt:48,productLeft:24,productTop:680,productWidth:1077,productHeight:576};
const logoBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#e00000'}}).jpeg().toBuffer(),productBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#00b020'}}).jpeg().toBuffer();
const source={shopId:'shop-1',logo:{origin:{kind:'SHOP_BRAND',shopId:'shop-1',shopDomain:'shop.example',role:'LOGO',sourceGeneration:1,sourceFingerprint:'sha256:'+hash(logoBytes)},contentSha256:hash(logoBytes)},product:{shopId:'shop-1',platform:'SHOPIFY',productId:'30',variantId:null,contentSha256:hash(productBytes)},headerText:'Shop: Example\\nWebsite: https://shop.example\\n──────────\\n',commonReferenceHash:'a'.repeat(64)};
const records=[];let vector;
for(const profile of [A,B])for(const selected of [true,false]){
 c.assertRecoveryCompositeProfileSafety(profile);const profileSha256=c.digestRecoveryCompositeProfile(profile,hash),identity=n.getRecoveryCompositeRuntimeIdentityV2({profile,profileSha256});
 const provenance={schemaVersion:2,...source,product:selected?source.product:null,layoutVersion:'RECOVERY_COMPOSITE_V2',rendererVersion:'RECOVERY_COMPOSITE_V2',profile,profileSha256,fontResourceSha256:identity.fontResourceSha256,runtimeSha256:identity.runtimeSha256};
 const renderer=n.createRecoveryCompositeImageRendererV2({profile,profileSha256}),start=performance.now(),rendered=await renderer.render({provenance,logoBytes,productBytes:selected?productBytes:null});
 const renderMs=performance.now()-start,again=await renderer.render({provenance,logoBytes,productBytes:selected?productBytes:null});assert.deepEqual(rendered.image.bytes,again.image.bytes);
 assert.equal(rendered.image.width,profile.canvasWidth);assert.equal(rendered.image.height,selected?profile.withProductHeight:profile.headerOnlyHeight);
 const raw=await sharp(rendered.image.bytes).raw().toBuffer({resolveWithObject:true});const pixel=(x,y)=>Array.from(raw.data.subarray((y*raw.info.width+x)*raw.info.channels,(y*raw.info.width+x)*raw.info.channels+3));
 const red=pixel(profile.logoLeft+90,profile.logoTop+90);assert.ok(red[0]>170&&red[1]<50);
 if(selected){const green=pixel(profile.productLeft+Math.floor(profile.productWidth/2),profile.productTop+Math.floor(profile.productHeight/2));assert.ok(green[1]>130&&green[0]<50);}
 const text=await sharp(rendered.image.bytes).extract({left:profile.textLeft,top:profile.textTop,width:profile.textWidth,height:profile.textHeight}).raw().toBuffer();assert.ok(Array.from(text).filter(v=>v<100).length>100);
 const tenantSha256=hash(source.shopId),renderIdentitySha256=c.digestRecoveryCompositeRenderIdentityV2(provenance,hash),objectKey='conversation-composites/v2/'+tenantSha256+'/'+renderIdentitySha256+'/'+rendered.image.contentSha256+'.jpg';
 const image={schemaVersion:2,provenance,tenantSha256,renderIdentitySha256,publicOrigin:'https://media.example',publicUrl:'https://media.example/'+objectKey,objectKey,contentSha256:rendered.image.contentSha256,contentType:'image/jpeg',byteLength:rendered.image.sizeBytes,width:rendered.image.width,height:rendered.image.height};
 const answerText='Complete answer',footerText='\\nHost-supplied alternate footer',trusted={provenance,publicOrigin:image.publicOrigin,body:answerText+footerText,answerText,footerText,logicalBody:source.headerText+answerText+footerText,checkoutUrl:'host-policy-only',output:{contentSha256:image.contentSha256,byteLength:image.byteLength,width:image.width,height:image.height,profileSha256,renderIdentitySha256}};
 const plan=c.buildRecoveryCompositeImagePlanV2({image,trusted},hash),carrier=c.buildRecoveryCompositeMultipartDeliveryPlanV2({plan,trusted},hash);
 assert.deepEqual(c.parseRecoveryCompositeMultipartDeliveryPlanV2(carrier,{checkoutUrl:'legacy-only',compositeV2:trusted},hash),carrier);
 assert.throws(()=>c.parseRecoveryCompositeImagePlanV2(plan,{...trusted,provenance:{...provenance,profile:profile===A?B:A}},hash));
 records.push({profile:profile===A?'left':'top-centered',selected,renderMs,width:image.width,height:image.height,textBounds:rendered.textBounds,profileSha256,runtimeSha256:identity.runtimeSha256,sha256:image.contentSha256});
 if(!vector)vector={profile,plan,trusted,carrier};
}
const prepared={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'text',value:'\\n'},{kind:'variable',name:'shop.websiteUrl'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'}]}]};

const profiled={...prepared,compositeProfile:A,compositeProfileSha256:c.digestRecoveryCompositeProfile(A,hash)},contentHash=hash(c.stableJson(profiled));
assert.equal(c.readPreparedWrapper({schemaVersion:1,prepared:profiled},contentHash,hash).kind,'ok');
const reference={schemaVersion:1,definitionId:'definition',sourceHash:'a'.repeat(64),localeId:'locale',languageTag:'en',contentHash,prepared:profiled};assert.equal(c.readCommonRecoveryLayoutReference(reference,hash).kind,'ok');
await writeFile('vector.json',JSON.stringify(vector));
console.log(JSON.stringify({sameArtifactTwoLayouts:true,savedTemplatePair:true,runtime:n.getRecoveryCompositeRuntimeIdentityV2({profile:A,profileSha256:c.digestRecoveryCompositeProfile(A,hash)}).runtime,records}));
`;
 await writeFile(join(root,'smoke.mjs'),smoke);if(process.env.MODA_COMPOSITE_V2_SMOKE_EXPORT)await writeFile(process.env.MODA_COMPOSITE_V2_SMOKE_EXPORT,smoke);
 process.stdout.write(execFileSync(process.execPath,[join(root,'smoke.mjs')],{cwd:root,encoding:'utf8'}));
 await writeFile(join(root,'types.ts'),`import {type RecoveryCompositeProfile,type RecoveryCompositeProvenanceV2,type RecoveryCompositeTrustedContextV2,type PreparedWrapper,assertRecoveryCompositeProfileSafety,parseRecoveryCompositeMultipartDeliveryPlanV2} from '@modainteract/moda-interact-shared/commerce/presentation';import {type RecoveryCompositePreparationInputV2,prepareRecoveryCompositeImageV2,getRecoveryCompositeRuntimeIdentityV2,createRecoveryCompositeImageRendererV2} from '@modainteract/moda-interact-shared/commerce/presentation/node';const f=(p:RecoveryCompositeProfile,h:string)=>{assertRecoveryCompositeProfileSafety(p);const identity=getRecoveryCompositeRuntimeIdentityV2({profile:p,profileSha256:h});return createRecoveryCompositeImageRendererV2({profile:p,profileSha256:h});};void f;const field:PreparedWrapper['compositeProfileSha256']=undefined;void field;const run=(i:RecoveryCompositePreparationInputV2)=>prepareRecoveryCompositeImageV2(i);void run;void parseRecoveryCompositeMultipartDeliveryPlanV2;`);
 execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(root,'types.ts')],{cwd:root,stdio:'pipe'});
 await writeFile(join(root,'browser.mjs'),`export * from '@modainteract/moda-interact-shared/commerce/presentation';`);
 const bundled=await build({absWorkingDir:root,entryPoints:['browser.mjs'],bundle:true,platform:'browser',format:'iife',globalName:'Presentation',write:false,metafile:true});
 assert.ok(!Object.keys(bundled.metafile.inputs).some(p=>/node:|sharp|@aws-sdk|prisma|\/logging\/|\/observability\/|langchain/.test(p)));
 const vector=JSON.parse(await readFile(join(root,'vector.json'),'utf8')),context=vm.createContext({Intl,URL,TextEncoder,TextDecoder,structuredClone,vector,sha:v=>createHash('sha256').update(v).digest('hex')});
 vm.runInContext(bundled.outputFiles[0].text,context,{timeout:10000});
 assert.equal(vm.runInContext('Presentation.parseRecoveryCompositeMultipartDeliveryPlanV2(vector.carrier,{checkoutUrl:"legacy",compositeV2:vector.trusted},sha).parts.length',context),1);
 console.log(JSON.stringify({artifactSha256:createHash('sha256').update(await readFile(artifact)).digest('hex'),installedTypes:true,browserIsolation:true}));
}finally{await rm(root,{recursive:true,force:true});}
