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
import {MAX_RECOVERY_DELIVERY_PARTS,RecoveryMultipartDeliveryPlanSchema,RecoveryMultipartDeliveryPartSchema,buildRecoveryMultipartDeliveryPlan,parseRecoveryMultipartDeliveryPlan,digestRecoveryMultipartDeliveryPlan} from '@modainteract/moda-interact-shared/commerce/presentation';
const checkoutUrl='https://shop.example/recover?key=synthetic';
const plan=buildRecoveryMultipartDeliveryPlan({checkoutUrl,parts:[{role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:'Complete answer\\n'+checkoutUrl}}]});
assert.equal(MAX_RECOVERY_DELIVERY_PARTS,3);assert.equal(RecoveryMultipartDeliveryPartSchema.safeParse(plan.parts[0]).success,true);assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(plan).success,true);assert.deepEqual(parseRecoveryMultipartDeliveryPlan(plan,checkoutUrl),plan);assert.equal(digestRecoveryMultipartDeliveryPlan(plan,()=> 'synthetic-digest'),'synthetic-digest');
assert.throws(()=>parseRecoveryMultipartDeliveryPlan(plan,'https://other.example/recover'));
`;
  await writeFile(join(root,'smoke.mjs'),code);
  execFileSync(process.execPath,[join(root,'smoke.mjs')],{cwd:root,stdio:'pipe'});
  await writeFile(join(root,'types.ts'),`import {buildRecoveryMultipartDeliveryPlan,parseRecoveryMultipartDeliveryPlan,digestRecoveryMultipartDeliveryPlan,MAX_RECOVERY_DELIVERY_PARTS,type RecoveryMultipartDeliveryPlan,type RecoveryMultipartDeliveryPart} from '@modainteract/moda-interact-shared/commerce/presentation';
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
  assert.equal(vm.runInContext(`Presentation.buildRecoveryMultipartDeliveryPlan({checkoutUrl:'https://shop.example/recover',parts:[{role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body:'Complete answer\\nhttps://shop.example/recover'}}]}).parts[0].plan.body`,context),'Complete answer\nhttps://shop.example/recover');
  const metadata=JSON.parse(await readFile(join(root,'node_modules/@modainteract/moda-interact-shared/package.json'),'utf8'));
  console.log(JSON.stringify({version:metadata.version,artifactSha256,nodeEsm:true,installedTypes:true,browserIsolation:true}));
} finally { await rm(root,{recursive:true,force:true}); }
