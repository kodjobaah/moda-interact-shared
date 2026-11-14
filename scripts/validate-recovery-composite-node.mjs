import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const artifact=process.argv[2]&&resolve(process.argv[2]);assert.ok(artifact,'Pass exact packed candidate tarball');
const root=await mkdtemp(join(tmpdir(),'moda-composite-node-package-'));
try {
 await writeFile(join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',artifact],{cwd:root,stdio:'pipe'});
 const smoke=`
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createRecoveryCompositeImageRenderer,RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256,RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256,RECOVERY_COMPOSITE_RENDER_PROFILE,verifyEncodedBrandImage,prepareRecoveryCompositeImage} from '@modainteract/moda-interact-shared/commerce/presentation/node';
import {stableJson} from '@modainteract/moda-interact-shared/commerce/presentation';
const hash=v=>createHash('sha256').update(v).digest('hex');
const assetRoot=new URL('./node_modules/@modainteract/moda-interact-shared/assets/recovery-composite/',import.meta.url);
assert.equal(hash(await readFile(new URL('DejaVuSans.ttf',assetRoot))),'7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954');
assert.equal(hash(await readFile(new URL('LICENSE.txt',assetRoot))),'7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93');
const manifest=JSON.parse(await readFile(new URL('manifest.json',assetRoot),'utf8'));
assert.equal(hash(stableJson(manifest)),RECOVERY_COMPOSITE_FONT_ASSET_MANIFEST_SHA256);
assert.equal(hash(await readFile(new URL('coverage.json',assetRoot))),manifest.coverageSha256);
const logoBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#dd0000'}}).jpeg().toBuffer();
const productBytes=await sharp({create:{width:1125,height:600,channels:3,background:'#00bb00'}}).jpeg().toBuffer();
const base={schemaVersion:1,shopId:'packed-shop',logo:{origin:{kind:'SHOP_BRAND',shopId:'packed-shop',shopDomain:'packed.example',role:'LOGO',sourceGeneration:1,sourceFingerprint:'sha256:'+hash(logoBytes)},contentSha256:hash(logoBytes)},headerText:'Shop: Packed example\\nWebsite: https://shop.example\\n──────────\\n',commonReferenceHash:'a'.repeat(64),layoutVersion:'RECOVERY_COMPOSITE_V1',rendererVersion:'RECOVERY_COMPOSITE_V1',fontAssetSha256:RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256};
const renderer=createRecoveryCompositeImageRenderer(),results=[];
for(const hasProduct of [true,false]) {
 const provenance={...base,product:hasProduct?{shopId:'packed-shop',platform:'SHOPIFY',productId:'30',variantId:null,contentSha256:hash(productBytes)}:null};
 const start=performance.now(),first=await renderer.render({provenance,logoBytes,productBytes:hasProduct?productBytes:null}),renderMs=performance.now()-start;
 const repeated=await renderer.render({provenance,logoBytes,productBytes:hasProduct?productBytes:null});
 assert.equal(first.image.contentSha256,repeated.image.contentSha256);
 assert.equal(first.image.height,hasProduct?900:300);assert.ok(first.textBounds.width<=813&&first.textBounds.height<=252);
 await assert.rejects(verifyEncodedBrandImage(first.image.bytes,'image/jpeg'));
 const channels=await sharp(first.image.bytes).raw().toBuffer({resolveWithObject:true});
 const at=(x,y)=>Array.from(channels.data.subarray((y*1125+x)*channels.info.channels,(y*1125+x)*channels.info.channels+3));
 const logo=at(138,150);assert.ok(logo[0]>150&&logo[1]<60);if(hasProduct){const photo=at(562,600);assert.ok(photo[1]>130&&photo[0]<60);}
 const text=await sharp(first.image.bytes).extract({left:264,top:24,width:813,height:252}).raw().toBuffer();assert.ok(Array.from(text).filter(v=>v<100).length>100);
 results.push({hasProduct,renderMs,sha256:first.image.contentSha256,textBounds:first.textBounds,width:first.image.width,height:first.image.height});
}
assert.equal(typeof prepareRecoveryCompositeImage,'function');
console.log(JSON.stringify({runtime:RECOVERY_COMPOSITE_RENDER_PROFILE,fontManifest:RECOVERY_COMPOSITE_FONT_MANIFEST_SHA256,packedAssets:true,license:true,pixels:true,results}));
`;
 await writeFile(join(root,'smoke.mjs'),smoke);
 if(process.env.MODA_COMPOSITE_SMOKE_EXPORT) await writeFile(process.env.MODA_COMPOSITE_SMOKE_EXPORT,smoke);
 const result=execFileSync(process.execPath,[join(root,'smoke.mjs')],{cwd:root,encoding:'utf8'});process.stdout.write(result);
 console.log(JSON.stringify({artifactSha256:createHash('sha256').update(await readFile(artifact)).digest('hex'),installedNodeAssets:true}));
}finally{await rm(root,{recursive:true,force:true});}
