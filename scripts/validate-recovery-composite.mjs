import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import vm from 'node:vm';
const artifact=process.argv[2]&&resolve(process.argv[2]);
assert.ok(artifact,'Pass the exact npm-packed candidate tarball');
const root=await mkdtemp(join(tmpdir(),'moda-composite-package-'));
try {
 await writeFile(join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',artifact,'legacy-shared@npm:@modainteract/moda-interact-shared@5.13.10'],{cwd:root,stdio:'pipe'});
 await writeFile(join(root,'smoke.mjs'),`
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as current from '@modainteract/moda-interact-shared/commerce/presentation';
import * as legacy from 'legacy-shared/commerce/presentation';
const sha=v=>createHash('sha256').update(v).digest('hex');
const provenance={schemaVersion:1,shopId:'shop-1',logo:{origin:{kind:'SHOP_BRAND',shopId:'shop-1',shopDomain:'shop.example',role:'LOGO',sourceGeneration:1,sourceFingerprint:'sha256:'+'a'.repeat(64)},contentSha256:'b'.repeat(64)},product:null,headerText:'Example shop\\nhttps://shop.example\\n\\n',commonReferenceHash:'c'.repeat(64),layoutVersion:'RECOVERY_COMPOSITE_V1',rendererVersion:'RECOVERY_COMPOSITE_V1',fontAssetSha256:'d'.repeat(64)};
const tenantSha256=sha(provenance.shopId),renderIdentitySha256=current.digestRecoveryCompositeRenderIdentity(provenance,sha),contentSha256='e'.repeat(64),publicOrigin='https://media.example';
const objectKey='conversation-composites/v1/'+tenantSha256+'/'+renderIdentitySha256+'/'+contentSha256+'.jpg';
const image={schemaVersion:1,provenance,tenantSha256,renderIdentitySha256,contentSha256,publicOrigin,objectKey,publicUrl:publicOrigin+'/'+objectKey,contentType:'image/jpeg',byteLength:500,width:1125,height:300};
const checkoutUrl='https://shop.example/recover?key=synthetic',answerText='Full answer',footerText='\\n\\n──────────\\n'+checkoutUrl;
const trusted={provenance,publicOrigin,answerText,footerText,checkoutUrl,logicalBody:provenance.headerText+answerText+footerText,output:{contentSha256,byteLength:500}};
const plan=current.buildRecoveryCompositeImagePlan({image,trusted},sha);
assert.deepEqual(current.parseRecoveryCompositeImagePlan(plan,trusted,sha),plan);
assert.equal(current.digestRecoveryCompositeImagePlan(plan,sha),sha(current.stableJson(plan)));
assert.equal(legacy.ConversationMediaDeliveryPlanSchema.safeParse(plan).success,false);
assert.equal(legacy.RecoveryMultipartDeliveryPlanSchema.safeParse(plan).success,false);
assert.equal(legacy.RecoveryCompositeImagePlanSchema,undefined);
const text={schemaVersion:1,kind:'TEXT',body:answerText+footerText};
const brand={schemaVersion:1,kind:'BRAND_IMAGE',body:text.body,image:{schemaVersion:1,origin:provenance.logo.origin,status:'READY',kind:'R2_DERIVATIVE',publicOrigin,objectKey:'shop-brands/shop.example/logo/sha256-'+contentSha256+'.jpg',publicUrl:publicOrigin+'/shop-brands/shop.example/logo/sha256-'+contentSha256+'.jpg',contentSha256,contentType:'image/jpeg',sizeBytes:500,width:1125,height:600,verifiedAt:'2026-11-13T00:00:00Z'}};
const product={schemaVersion:1,kind:'IMAGE',body:text.body,image:{schemaVersion:1,shopId:'shop-1',productId:'30',variantId:null,publicUrl:publicOrigin+'/product.jpg',objectKey:'conversation-products/v1/'+'a'.repeat(64)+'/'+'b'.repeat(64)+'/'+contentSha256+'.jpg',contentSha256,contentType:'image/jpeg',byteLength:500,width:1125,height:600}};
for(const old of [text,brand,product]) {
 assert.deepEqual(current.ConversationCompositeMediaDeliveryPlanSchema.parse(old),legacy.ConversationMediaDeliveryPlanSchema.parse(old));
 assert.equal(current.digestConversationMediaDeliveryPlan(old,sha),legacy.digestConversationMediaDeliveryPlan(old,sha));
}
const header={role:'HEADER',plan:brand},answer={role:'ANSWER',plan:text},photo={role:'PRODUCT',plan:product};
for(const parts of [[header],[answer],[header,answer],[header,photo],[header,photo,answer]]) {
 const old={schemaVersion:1,kind:'RECOVERY_MULTIPART',parts};
 assert.deepEqual(current.RecoveryMultipartDeliveryPlanSchema.parse(old),legacy.RecoveryMultipartDeliveryPlanSchema.parse(old));
 assert.equal(current.digestRecoveryMultipartDeliveryPlan(old,sha),legacy.digestRecoveryMultipartDeliveryPlan(old,sha));
}
writeFileSync('vector.json',JSON.stringify({plan,trusted}));
`);
 execFileSync(process.execPath,[join(root,'smoke.mjs')],{cwd:root,stdio:'pipe'});
 await writeFile(join(root,'types.ts'),`import {RECOVERY_COMPOSITE_LAYOUT_V1,RecoveryCompositeImagePlanSchema,parseRecoveryCompositeImagePlan,type RecoveryCompositeImagePlan,type RecoveryCompositeTrustedContext,type RecoveryCompositeProvenance} from '@modainteract/moda-interact-shared/commerce/presentation';
const check=(p:RecoveryCompositeImagePlan,t:RecoveryCompositeTrustedContext)=>parseRecoveryCompositeImagePlan(p,t,()=> 'a'.repeat(64));void check;void RecoveryCompositeImagePlanSchema;const width:1125=RECOVERY_COMPOSITE_LAYOUT_V1.width;void width;const p:RecoveryCompositeProvenance['product']=null;void p;`);
 execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(root,'types.ts')],{cwd:root,stdio:'pipe'});
 await writeFile(join(root,'browser.mjs'),`export * from '@modainteract/moda-interact-shared/commerce/presentation';`);
 const bundled=await build({absWorkingDir:root,entryPoints:['browser.mjs'],bundle:true,platform:'browser',format:'iife',globalName:'Presentation',write:false,metafile:true});
 assert.ok(!Object.keys(bundled.metafile.inputs).some(path=>/node:|sharp|@aws-sdk|prisma|\/logging\/|\/observability\/|langchain/.test(path)));
 const vector=JSON.parse(await readFile(join(root,'vector.json'),'utf8'));
 const context=vm.createContext({Intl,URL,TextEncoder,TextDecoder,structuredClone,raw:vector.plan,trusted:vector.trusted});
 vm.runInContext(bundled.outputFiles[0].text,context,{timeout:10000});
 assert.equal(vm.runInContext('Presentation.RecoveryCompositeImagePlanSchema.safeParse(raw).success',context),true);
 // Browser parser executes every cryptographic comparison using the precomputed exact SHA results.
 const digestInputs=new Map(); const hash=v=>{const out=createHash('sha256').update(v).digest('hex');digestInputs.set(v,out);return out;};
 hash(vector.trusted.provenance.shopId);hash(vm.runInContext('Presentation.stableJson(raw.image.provenance)',context));
 const t=vector.trusted;hash(vm.runInContext(`Presentation.stableJson({headerText:trusted.provenance.headerText,answerText:trusted.answerText,footerText:trusted.footerText,logicalBody:trusted.logicalBody,body:raw.body})`,context));
 context.sha=value=>{assert.ok(digestInputs.has(value));return digestInputs.get(value);};
 assert.equal(vm.runInContext('Presentation.parseRecoveryCompositeImagePlan(raw,trusted,sha).body',context),vector.plan.body);
 console.log(JSON.stringify({artifactSha256:createHash('sha256').update(await readFile(artifact)).digest('hex'),installedEsm:true,installedTypes:true,browserIsolation:true,published51310RejectsComposite:true,exactLegacyVectors:true}));
} finally {await rm(root,{recursive:true,force:true});}
