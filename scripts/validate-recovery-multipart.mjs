import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import vm from 'node:vm';

const artifact = process.argv[2] && resolve(process.argv[2]);
assert.ok(artifact, 'Pass the exact npm-packed candidate tarball');
const bytes = await readFile(artifact);
const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'moda-multipart-package-'));
try {
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
  execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',artifact],{cwd:root,stdio:'pipe'});
  const code = `import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RecoveryTemplateSemanticKeySchema} from '@modainteract/moda-interact-shared/recovery-template-bindings';
import {InitialOutreachRenderInputSchema} from '@modainteract/moda-interact-shared/commerce/outreach';
import {readCommonRecoveryLayoutReference,readPreparedWrapper,renderPreparedWrapper,stableJson,MAX_RECOVERY_DELIVERY_PARTS,RecoveryMultipartDeliveryPlanSchema,RecoveryMultipartDeliveryPartSchema,buildRecoveryMultipartDeliveryPlan,parseRecoveryMultipartDeliveryPlan,digestRecoveryMultipartDeliveryPlan} from '@modainteract/moda-interact-shared/commerce/presentation';
const checkoutUrl='https://shop.example/recover?key=synthetic';
const plan=buildRecoveryMultipartDeliveryPlan({checkoutUrl,parts:[{role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:'Complete answer\\n'+checkoutUrl}}]});
assert.equal(MAX_RECOVERY_DELIVERY_PARTS,3);assert.equal(RecoveryMultipartDeliveryPartSchema.safeParse(plan.parts[0]).success,true);assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(plan).success,true);assert.deepEqual(parseRecoveryMultipartDeliveryPlan(plan,checkoutUrl),plan);assert.equal(digestRecoveryMultipartDeliveryPlan(plan,()=> 'synthetic-digest'),'synthetic-digest');
assert.throws(()=>parseRecoveryMultipartDeliveryPlan(plan,'https://other.example/recover'));
assert.equal(RecoveryTemplateSemanticKeySchema.parse('shop.websiteUrl'),'shop.websiteUrl');
const variables={shopName:'Saved shop',customerFirstName:null,checkoutUrl,shopCategory:null,shopWebsiteUrl:'https://shop.example'};
assert.equal(InitialOutreachRenderInputSchema.shape.variables.safeParse(variables).success,true);
assert.equal(InitialOutreachRenderInputSchema.shape.variables.safeParse({...variables,shopWebsiteUrl:'https://shop.example/products'}).success,false);
const prepared={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'text',value:'\\n'},{kind:'variable',name:'shop.websiteUrl'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'}]}]};
const sha=value=>createHash('sha256').update(value).digest('hex');
const reference={schemaVersion:1,definitionId:'definition',sourceHash:'a'.repeat(64),localeId:'locale',languageTag:'en',contentHash:sha(stableJson(prepared)),prepared};
assert.equal(readCommonRecoveryLayoutReference(reference,sha).kind,'ok');
assert.equal(readCommonRecoveryLayoutReference({...reference,extra:true},sha).kind,'invalid');
for(const [section,name] of [['header','customer.firstName'],['conditional','shopBrand.logoUrl']]){
 const injected=section==='header'?{...prepared,header:[...prepared.header,{kind:'variable',name}]}:{...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name},{kind:'text',value:'\\n'},...prepared.conditionals[0].tokens]}]};
 const injectedHash=sha(stableJson(injected));assert.equal(readPreparedWrapper({schemaVersion:1,prepared:injected},injectedHash,sha).kind,'ok');
 assert.equal(readCommonRecoveryLayoutReference({...reference,prepared:injected,contentHash:injectedHash},sha).kind,'invalid');
}

assert.equal(readPreparedWrapper({schemaVersion:1,prepared},reference.contentHash,sha).kind,'ok');
assert.equal(renderPreparedWrapper({prepared,context:{conversationId:'c',shopId:'s',conversationLanguageTag:'en',merchantLanguageTag:'en',variables:{'shop.name':'Saved shop','shop.websiteUrl':'https://shop.example','checkout.url':checkoutUrl},checkoutAvailable:true},responseBody:'Authored family body'}).body,'Saved shop\\nhttps://shop.example\\nAuthored family body\\n'+checkoutUrl);

`;
  await writeFile(join(root,'smoke.mjs'),code);
  execFileSync(process.execPath,[join(root,'smoke.mjs')],{cwd:root,stdio:'pipe'});
  await writeFile(join(root,'types.ts'),`import type {RecoveryTemplateSemanticKey} from '@modainteract/moda-interact-shared/recovery-template-bindings';
import type {InitialOutreachRenderInput} from '@modainteract/moda-interact-shared/commerce/outreach';
import {readCommonRecoveryLayoutReference,buildRecoveryMultipartDeliveryPlan,parseRecoveryMultipartDeliveryPlan,digestRecoveryMultipartDeliveryPlan,MAX_RECOVERY_DELIVERY_PARTS,type CommonRecoveryLayoutReference,type WrapperVariable,type RecoveryMultipartDeliveryPlan,type RecoveryMultipartDeliveryPart} from '@modainteract/moda-interact-shared/commerce/presentation';
const semantic:RecoveryTemplateSemanticKey='shop.websiteUrl';const variable:WrapperVariable='shop.websiteUrl';
const website:InitialOutreachRenderInput['variables']['shopWebsiteUrl']='https://shop.example';
const read=readCommonRecoveryLayoutReference({},()=> 'a'.repeat(64));if(read.kind==='ok'){const reference:CommonRecoveryLayoutReference=read.reference;void reference;}void semantic;void variable;void website;
const part:RecoveryMultipartDeliveryPart={role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:'Answer\\nhttps://shop.example/recover'}};
// @ts-expect-error PRODUCT role requires the product IMAGE plan, never plain text
const invalid:RecoveryMultipartDeliveryPart={role:'PRODUCT',plan:{schemaVersion:1,kind:'TEXT',body:'Not product media'}};void invalid;
const plan:RecoveryMultipartDeliveryPlan=buildRecoveryMultipartDeliveryPlan({parts:[part],checkoutUrl:'https://shop.example/recover'});
const parsed:RecoveryMultipartDeliveryPlan=parseRecoveryMultipartDeliveryPlan(plan,'https://shop.example/recover');
const digest:string=digestRecoveryMultipartDeliveryPlan(parsed,()=> 'digest');const limit:3=MAX_RECOVERY_DELIVERY_PARTS;void digest;void limit;
`);
  execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(root,'types.ts')],{cwd:root,stdio:'pipe'});
  await writeFile(join(root,'browser.mjs'),`export * from '@modainteract/moda-interact-shared/commerce/presentation';`);
  const bundled=await build({absWorkingDir:root,entryPoints:['browser.mjs'],bundle:true,platform:'browser',format:'iife',globalName:'Presentation',write:false,metafile:true});
  assert.ok(!Object.keys(bundled.metafile.inputs).some(path=>/node:|sharp|@aws-sdk|prisma|\/logging\/|\/observability\/|langchain/.test(path)));
  const context=vm.createContext({Intl,URL,TextEncoder,TextDecoder,structuredClone});
  vm.runInContext(bundled.outputFiles[0].text,context,{timeout:10000});
  assert.equal(vm.runInContext('Presentation.MAX_RECOVERY_DELIVERY_PARTS',context),3);
  assert.equal(vm.runInContext(`Presentation.readCommonRecoveryLayoutReference({schemaVersion:1,definitionId:'definition',sourceHash:'a'.repeat(64),localeId:'locale',languageTag:'en',contentHash:'b'.repeat(64),prepared:{schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'variable',name:'shop.websiteUrl'},{kind:'variable',name:'customer.firstName'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'}]}]}},()=> 'b'.repeat(64)).kind`,context),'invalid');

  assert.equal(vm.runInContext(`Presentation.readCommonRecoveryLayoutReference({schemaVersion:1,definitionId:'definition',sourceHash:'a'.repeat(64),localeId:'locale',languageTag:'en',contentHash:'b'.repeat(64),prepared:{schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'variable',name:'shop.websiteUrl'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'}]}]}},()=> 'b'.repeat(64)).kind`,context),'ok');
  assert.equal(vm.runInContext(`Presentation.buildRecoveryMultipartDeliveryPlan({checkoutUrl:'https://shop.example/recover',parts:[{role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:'Complete answer\\nhttps://shop.example/recover'}}]}).parts[0].plan.body`,context),'Complete answer\nhttps://shop.example/recover');
  const metadata=JSON.parse(await readFile(join(root,'node_modules/@modainteract/moda-interact-shared/package.json'),'utf8'));
  console.log(JSON.stringify({version:metadata.version,artifactSha256,nodeEsm:true,installedTypes:true,browserIsolation:true,commonLayoutWebsite:true}));
} finally { await rm(root,{recursive:true,force:true}); }
