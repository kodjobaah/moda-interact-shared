import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  RECOVERY_COMPOSITE_LAYOUT_V1, RecoveryCompositeProvenanceSchema, RecoveryPreparedCompositeImageSchema, RecoveryCompositeImagePlanSchema,
  ConversationCompositeMediaDeliveryPlanSchema, buildRecoveryCompositeImagePlan,
  parseRecoveryCompositeImagePlan, digestRecoveryCompositeImagePlan, digestRecoveryCompositeRenderIdentity,
  ConversationMediaDeliveryPlanSchema, ConversationDeliveryPlanSchema, RecoveryMultipartDeliveryPlanSchema,
  digestConversationMediaDeliveryPlan, digestRecoveryMultipartDeliveryPlan, stableJson,
  type RecoveryCompositeProvenance, type RecoveryCompositeTrustedContext,
} from './index.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const checkoutUrl='https://shop.example/recover?key=synthetic';
const logo={origin:{kind:'SHOP_BRAND' as const,shopId:'shop-1',shopDomain:'shop.example',role:'LOGO' as const,sourceGeneration:1,sourceFingerprint:`sha256:${'a'.repeat(64)}`},contentSha256:'b'.repeat(64)};
const provenance:RecoveryCompositeProvenance={schemaVersion:1,shopId:'shop-1',logo,product:{shopId:'shop-1',platform:'SHOPIFY',productId:'30',variantId:null,contentSha256:'c'.repeat(64)},headerText:'Welcome to Example shop\nhttps://shop.example\n\n',commonReferenceHash:'d'.repeat(64),layoutVersion:'RECOVERY_COMPOSITE_V1',rendererVersion:'RECOVERY_COMPOSITE_V1',fontAssetSha256:'e'.repeat(64)};
function fixture(p:RecoveryCompositeProvenance=provenance,answerText='Complete answer') {
 const footerText=`\n\n──────────\n${checkoutUrl}`;
 const logicalBody=`${p.headerText}${answerText}${footerText}`;
 const trusted:RecoveryCompositeTrustedContext={provenance:p,publicOrigin:'https://media.example',answerText,footerText,logicalBody,checkoutUrl,output:{contentSha256:'f'.repeat(64),byteLength:500}};
 const contentSha256='f'.repeat(64),tenantSha256=hash(p.shopId),renderIdentitySha256=digestRecoveryCompositeRenderIdentity(p,hash);
 const objectKey=`conversation-composites/v1/${tenantSha256}/${renderIdentitySha256}/${contentSha256}.jpg`;
 const image={schemaVersion:1 as const,provenance:p,tenantSha256,renderIdentitySha256,publicOrigin:trusted.publicOrigin,publicUrl:`${trusted.publicOrigin}/${objectKey}`,objectKey,contentSha256,contentType:'image/jpeg' as const,byteLength:500,width:1125 as const,height:p.product===null?300:900};
 return {image,trusted};
}
const build=(f=fixture())=>buildRecoveryCompositeImagePlan({image:f.image,trusted:f.trusted},hash);
const clone=<T>(v:T):T=>structuredClone(v);
test('composite retains explicit optional product and exact real caption/logical body',()=>{
 for(const p of [provenance,{...provenance,product:null},{...provenance,logo:{...logo,origin:{...logo.origin,role:'SQUARE_LOGO' as const}}}]) {
  const f=fixture(p),plan=build(f);
  assert.equal(plan.kind,'COMPOSITE_IMAGE'); assert.equal(plan.body,`${f.trusted.answerText}${f.trusted.footerText}`);
  assert.equal(plan.logicalBody,f.trusted.logicalBody);assert.equal(plan.image.height,p.product?900:300);
  assert.deepEqual(parseRecoveryCompositeImagePlan(plan,f.trusted,hash),plan);
  assert.deepEqual(ConversationCompositeMediaDeliveryPlanSchema.parse(plan),plan);
 }
});
test('caption Unicode boundary counts codepoints without truncating logical text or counting URLs globally',()=>{
 const f=fixture();const suffix=f.trusted.footerText;
 const exact='😀'.repeat(1024-Array.from(suffix).length);
 const plan=build(fixture(provenance,exact));assert.equal(Array.from(plan.body).length,1024);
 assert.throws(()=>build(fixture(provenance,'😀'+exact)));
 const answer='Authored URL https://else.example and divider ──────────';assert.ok(build(fixture(provenance,answer)).body.startsWith(answer));
});
test('mixed tenants, forged logo roles, absent product field, unknown keys, control and oversize inputs fail',()=>{
 const changes=[{...provenance,shopId:'foreign'},{...provenance,product:{...provenance.product!,shopId:'foreign'}},{...provenance,logo:{...logo,origin:{...logo.origin,role:'COVER_IMAGE'}}},{...provenance,logo:{...logo,contentSha256:'bad'}},{...provenance,product:undefined},{...provenance,headerText:'bad\u0000'},{...provenance,headerText:'x'.repeat(513)},{...provenance,headerText:'a\n'.repeat(7)},{...provenance,extra:true}];
 for(const p of changes)assert.equal(RecoveryCompositeProvenanceSchema.safeParse(p).success,false);
 for(const answer of ['bad\u0000','bad\u007f','bad\ud800','x'.repeat(4097),' '])assert.throws(()=>build(fixture(provenance,answer)));
});
test('output binds strict origin/key/hash, geometry, MIME and size',()=>{
 const f=fixture();
 for(const patch of [{publicOrigin:'https://media.example/'},{publicOrigin:'https://u:p@media.example'},{publicUrl:'https://evil.example/image.jpg'},{objectKey:f.image.objectKey.replace('f'.repeat(64),'a'.repeat(64))},{contentSha256:'bad'},{width:1126},{height:600},{height:300},{contentType:'image/png'},{byteLength:5*1024*1024},{byteLength:0},{extra:true}])
  assert.equal(RecoveryPreparedCompositeImageSchema.safeParse({...f.image,...patch}).success,false,JSON.stringify(patch));
 for(const patch of [{tenantSha256:'a'.repeat(64)},{renderIdentitySha256:'a'.repeat(64)},{contentSha256:'a'.repeat(64)}]) {
  const modified={...f.image,...patch};modified.objectKey=`conversation-composites/v1/${modified.tenantSha256}/${modified.renderIdentitySha256}/${modified.contentSha256}.jpg`;modified.publicUrl=`${modified.publicOrigin}/${modified.objectKey}`;
  assert.throws(()=>buildRecoveryCompositeImagePlan({image:modified,trusted:f.trusted},hash));
 }
});
test('trusted boundaries/provenance are compared exactly rather than inferred by inclusion',()=>{
 const f=fixture(),plan=build(f);
 for(const patch of [{body:'prefix\n'+plan.body},{logicalBody:'prefix\n'+plan.logicalBody},{boundarySha256:'a'.repeat(64)}])assert.throws(()=>parseRecoveryCompositeImagePlan({...plan,...patch},f.trusted,hash));
 for(const patch of [{checkoutUrl:'https://other.example/recover'},{checkoutUrl:'javascript:bad'},{footerText:f.trusted.footerText+' '},{answerText:'different'},{logicalBody:'different'},{publicOrigin:'https://other.example'},{provenance:{...provenance,commonReferenceHash:'a'.repeat(64)}},{provenance:{...provenance,logo:{...logo,origin:{...logo.origin,sourceGeneration:2}}}}])assert.throws(()=>parseRecoveryCompositeImagePlan(plan,{...f.trusted,...patch},hash));
 assert.equal(RecoveryCompositeImagePlanSchema.safeParse({...plan,schemaVersion:2}).success,false);
});
test('render identity binds all reusable inputs, excluding answer/footer from reusable bitmap',()=>{
 const identity=digestRecoveryCompositeRenderIdentity(provenance,hash);
 for(const p of [{...provenance,headerText:'Changed header'},{...provenance,fontAssetSha256:'a'.repeat(64)},{...provenance,commonReferenceHash:'a'.repeat(64)},{...provenance,product:null},{...provenance,product:{...provenance.product!,contentSha256:'a'.repeat(64)}}])assert.notEqual(digestRecoveryCompositeRenderIdentity(p,hash),identity);
 const a=build(),b=build(fixture(provenance,'Other answer'));
 assert.equal(a.image.renderIdentitySha256,b.image.renderIdentitySha256);
 assert.notEqual(a.boundarySha256,b.boundarySha256);assert.notEqual(digestRecoveryCompositeImagePlan(a,hash),digestRecoveryCompositeImagePlan(b,hash));
 const changed=clone(a);changed.image.byteLength++;assert.notEqual(digestRecoveryCompositeImagePlan(a,hash),digestRecoveryCompositeImagePlan(changed,hash));
});
test('legacy validators reject new kind while additive reader preserves exact old bytes/digests',()=>{
 const plan=build();for(const schema of [ConversationMediaDeliveryPlanSchema,ConversationDeliveryPlanSchema,RecoveryMultipartDeliveryPlanSchema])assert.equal(schema.safeParse(plan).success,false);
 const body=`Complete answer\n${checkoutUrl}`;const legacy={schemaVersion:1 as const,kind:'TEXT' as const,body};
 assert.deepEqual(ConversationCompositeMediaDeliveryPlanSchema.parse(legacy),legacy);
 assert.equal(digestConversationMediaDeliveryPlan(legacy,hash),hash(stableJson(legacy)));
 for(const roles of [['ANSWER'],['HEADER'],['HEADER','ANSWER']] as const) {
  const old={schemaVersion:1 as const,kind:'RECOVERY_MULTIPART' as const,parts:roles.map(role=>({role,plan:legacy}))};
  assert.equal(stableJson(RecoveryMultipartDeliveryPlanSchema.parse(old)),stableJson(old));assert.equal(digestRecoveryMultipartDeliveryPlan(old,hash),hash(stableJson(old)));
 }
});

test('canonical boundaries own every byte of whitespace; concatenation adds no separators',()=>{
 const p={...provenance,headerText:'Example shop  \nhttps://shop.example\n\n'};
 const f=fixture(p,'Authored answer  '),plan=build(f);
 assert.equal(plan.body,'Authored answer  '+f.trusted.footerText);
 assert.equal(plan.logicalBody,p.headerText+'Authored answer  '+f.trusted.footerText);
 assert.equal(plan.image.provenance.headerText,p.headerText);
 assert.throws(()=>parseRecoveryCompositeImagePlan({...plan,body:'\n'+plan.body},f.trusted,hash));
});

test('exact concatenated caption still requires checkout URL on its own final line',()=>{
 const f=fixture();
 const trusted={...f.trusted,footerText:checkoutUrl,logicalBody:provenance.headerText+f.trusted.answerText+checkoutUrl};
 assert.throws(()=>buildRecoveryCompositeImagePlan({image:f.image,trusted},hash));
 const withNewline={...trusted,answerText:trusted.answerText+'\n',logicalBody:provenance.headerText+trusted.answerText+'\n'+checkoutUrl};
 assert.equal(buildRecoveryCompositeImagePlan({image:f.image,trusted:withNewline},hash).body,withNewline.answerText+checkoutUrl);
});

test('layout preserves the full authored header once and prescribes no extra graphic divider',()=>{
 const p={...provenance,headerText:'Example shop\nhttps://shop.example\n──────────\n\n'};
 const plan=build(fixture(p));
 assert.equal(plan.image.provenance.headerText,p.headerText);
 assert.equal(plan.logicalBody,p.headerText+plan.body);
 assert.equal(Object.keys(RECOVERY_COMPOSITE_LAYOUT_V1).some(key=>key.startsWith('divider')),false);
});

test('readable header reserves an independent 813 by 252 text box and vertically centered modest logo',()=>{
 assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.textTop,24);assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.textHeight,252);
 assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.textWidth,813);assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.logoTop,60);
 assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.logoHeight,180);assert.equal(RECOVERY_COMPOSITE_LAYOUT_V1.headerHeight,300);
});
