import test from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryCompositeProfileSchema,assertRecoveryCompositeProfileSafety,readRecoveryCompositeProfile,digestRecoveryCompositeProfile,assertRecoveryCompositeTextAllocationV2} from './composite-profile.js';
import {RecoveryCompositeProvenanceV2Schema,RecoveryPreparedCompositeImageV2Schema,buildRecoveryCompositeImagePlanV2,parseRecoveryCompositeImagePlanV2,digestRecoveryCompositeRenderIdentityV2,assertRecoveryCompositeOutputIdentityV2,type RecoveryCompositeTrustedContextV2} from './composite-image-v2.js';
import {buildRecoveryCompositeMultipartDeliveryPlanV2,parseRecoveryCompositeMultipartDeliveryPlanV2,RecoveryCompositeMultipartDeliveryPlanV2Schema,digestRecoveryCompositeMultipartDeliveryPlanV2} from './composite-recovery-v2.js';
import {RecoveryMultipartDeliveryPlanSchema} from './recovery-multipart.js';
import {digestRecoveryMultipartDeliveryPlan} from './recovery-multipart.js';
import {consumerProfileA as A,consumerProfileB as B,fixtureV2,hash} from './node/composite-v2.test-fixtures.js';
const checkoutUrl='https://shop.example/recover?key=synthetic';
async function wire(){const f=await fixtureV2(A,false),renderIdentitySha256=digestRecoveryCompositeRenderIdentityV2(f.provenance,hash),contentSha256='f'.repeat(64),tenantSha256=hash(f.provenance.shopId),objectKey=`conversation-composites/v2/${tenantSha256}/${renderIdentitySha256}/${contentSha256}.jpg`;
 const image={schemaVersion:2 as const,provenance:f.provenance,tenantSha256,renderIdentitySha256,publicOrigin:'https://media.example',publicUrl:`https://media.example/${objectKey}`,objectKey,contentSha256,contentType:'image/jpeg',byteLength:500,width:A.canvasWidth,height:A.headerOnlyHeight};
 const answerText=`Authored answer already includes ${checkoutUrl}`,footerText='\n──────────\n'+checkoutUrl;
 const trusted:RecoveryCompositeTrustedContextV2={provenance:f.provenance,publicOrigin:image.publicOrigin,body:answerText+footerText,answerText,footerText,logicalBody:f.provenance.headerText+answerText+footerText,checkoutUrl,output:{contentSha256,byteLength:500,width:image.width,height:image.height,profileSha256:f.profileSha256,renderIdentitySha256}};
 return {f,image,trusted,plan:buildRecoveryCompositeImagePlanV2({image,trusted},hash)};}
test('structural profile schema does not enforce Admin operational ranges, overlap, placement or ratios',()=>{
 const other={...A,canvasWidth:400,headerOnlyHeight:200,withProductHeight:200,logoLeft:0,logoTop:0,logoWidth:8,logoHeight:8,textLeft:0,textTop:0,textWidth:200,textHeight:120,fontSize:12,textLineSpacingPt:1,productLeft:0,productTop:0,productWidth:100,productHeight:100};
 assert.deepEqual(RecoveryCompositeProfileSchema.parse(other),other);assert.doesNotThrow(()=>assertRecoveryCompositeProfileSafety(other));
 for(const p of [A,B]){assertRecoveryCompositeProfileSafety(p);const frozen=readRecoveryCompositeProfile(p,digestRecoveryCompositeProfile(p,hash),hash);assert.equal(Object.isFrozen(frozen),true);}
 assert.notEqual(digestRecoveryCompositeProfile(A,hash),digestRecoveryCompositeProfile(B,hash));
 assert.equal(RecoveryCompositeProfileSchema.safeParse({...A,fontId:'REMOTE_FONT'}).success,false);assert.equal(RecoveryCompositeProfileSchema.safeParse({...A,fontSize:undefined}).success,false);assert.equal(RecoveryCompositeProfileSchema.safeParse({...A,css:'x'}).success,false);
});
test('explicit technical safety rejects invalid allocations/containment without any Zod refinement',()=>{
 for(const patch of [{canvasWidth:0},{fontSize:0},{fontSize:1.5},{logoLeft:-1},{textLineSpacingPt:-1},{logoTop:1000},{productLeft:2000},{canvasWidth:2_000_001},{withProductHeight:2_000_001}]){
  const p={...A,...patch};assert.equal(RecoveryCompositeProfileSchema.safeParse(p).success,true);assert.throws(()=>assertRecoveryCompositeProfileSafety(p));
 }
 assert.throws(()=>assertRecoveryCompositeProfileSafety({...A,fontSize:Infinity}));assert.throws(()=>readRecoveryCompositeProfile(A,'a'.repeat(64),hash));
 assert.throws(()=>assertRecoveryCompositeTextAllocationV2({...A,fontSize:1_000_000},'X'));
});
test('V2 structural wire permits identity-shaped data; explicit trusted functions enforce tenant/profile/output authority',async()=>{
 const w=await wire();assert.equal(w.plan.body,w.trusted.answerText+w.trusted.footerText);assert.deepEqual(parseRecoveryCompositeImagePlanV2(w.plan,w.trusted,hash),w.plan);
 const foreign={...w.f.provenance,shopId:'foreign'};assert.equal(RecoveryCompositeProvenanceV2Schema.safeParse(foreign).success,true);
 assert.throws(()=>digestRecoveryCompositeRenderIdentityV2(foreign,hash));
 for(const patch of [{width:600},{height:900},{publicUrl:'https://evil.example/image.jpg'},{contentSha256:'a'.repeat(64)},{byteLength:5*1024*1024}]){const image={...w.image,...patch};assert.equal(RecoveryPreparedCompositeImageV2Schema.safeParse(image).success,true);assert.throws(()=>assertRecoveryCompositeOutputIdentityV2(image,hash));}
 for(const trusted of [{...w.trusted,provenance:{...w.f.provenance,profile:B}},{...w.trusted,answerText:'Different'},{...w.trusted,output:{...w.trusted.output,profileSha256:'a'.repeat(64)}},{...w.trusted,logicalBody:'Not original'}])assert.throws(()=>parseRecoveryCompositeImagePlanV2(w.plan,trusted,hash));
});
test('single V2 carrier requires independent context and delegates old carriers without digest changes',async()=>{
 const w=await wire(),carrier=buildRecoveryCompositeMultipartDeliveryPlanV2({plan:w.plan,trusted:w.trusted},hash);
 assert.deepEqual(parseRecoveryCompositeMultipartDeliveryPlanV2(carrier,{checkoutUrl,compositeV2:w.trusted},hash),carrier);assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(carrier).success,false);
 assert.throws(()=>parseRecoveryCompositeMultipartDeliveryPlanV2(carrier,{checkoutUrl,compositeV2:null},hash));
 for(const parts of [[...carrier.parts,...carrier.parts],[{role:'ANSWER',plan:w.plan}]])assert.equal(RecoveryCompositeMultipartDeliveryPlanV2Schema.safeParse({...carrier,parts}).success,false);
 const legacy={schemaVersion:1 as const,kind:'RECOVERY_MULTIPART' as const,parts:[{role:'ANSWER' as const,plan:{schemaVersion:1 as const,kind:'TEXT' as const,body:'Answer\n'+checkoutUrl}}]};
 assert.deepEqual(parseRecoveryCompositeMultipartDeliveryPlanV2(legacy,{checkoutUrl,compositeV2:null},hash),legacy);assert.equal(digestRecoveryCompositeMultipartDeliveryPlanV2(legacy,hash),digestRecoveryMultipartDeliveryPlan(legacy,hash));
});

test('saved-template prepared profile pair is optional, whole-hash-bound and propagated by existing common reference reader',async()=>{
 const {readPreparedWrapper,readCommonRecoveryLayoutReference,stableJson,renderPreparedWrapper}=await import('./index.js');
 const base={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'text',value:'\n'},{kind:'variable',name:'shop.websiteUrl'},{kind:'text',value:'\n──────────\n'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'\n──────────\n'},{kind:'variable',name:'checkout.url'}]}]};
 const oldHash=hash(stableJson(base)),old=readPreparedWrapper({schemaVersion:1,prepared:base},oldHash,hash);assert.equal(old.kind,'ok');if(old.kind!=='ok')return;
 assert.equal(Object.hasOwn(old.prepared,'compositeProfile'),false);assert.equal(hash(stableJson(old.prepared)),oldHash);
 const profileSha=digestRecoveryCompositeProfile(A,hash),prepared={...base,compositeProfile:A,compositeProfileSha256:profileSha},contentHash=hash(stableJson(prepared));
 const read=readPreparedWrapper({schemaVersion:1,prepared},contentHash,hash);assert.equal(read.kind,'ok');if(read.kind!=='ok')return;
 assert.deepEqual(read.prepared.compositeProfile,A);assert.equal(read.prepared.compositeProfileSha256,profileSha);
 const reference={schemaVersion:1,definitionId:'definition',sourceHash:'a'.repeat(64),localeId:'locale',languageTag:'en',contentHash,prepared};
 const common=readCommonRecoveryLayoutReference(reference,hash);assert.equal(common.kind,'ok');if(common.kind==='ok')assert.deepEqual(common.reference.prepared.compositeProfile,A);
 for(const bad of [{...base,compositeProfile:A},{...base,compositeProfileSha256:profileSha},{...prepared,compositeProfile:B},{...prepared,compositeProfileSha256:'a'.repeat(64)}])assert.equal(readPreparedWrapper({schemaVersion:1,prepared:bad},hash(stableJson(bad)),hash).kind,'invalid');
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared},oldHash,hash).kind,'invalid');
 const context={conversationId:'c',shopId:'s',conversationLanguageTag:'en',merchantLanguageTag:'en',variables:{'shop.name':'Example','shop.websiteUrl':'https://shop.example','checkout.url':checkoutUrl},checkoutAvailable:true};
 assert.deepEqual(renderPreparedWrapper({prepared:read.prepared,context,responseBody:'Answer'}),renderPreparedWrapper({prepared:old.prepared,context,responseBody:'Answer'}));
});

test('V2 binds alternate host-supplied footer/parts without Shared checkout placement or nonblank policy',async()=>{
 const w=await wire();
 for(const footerText of ['\nHost-authorized alternate footer','']){
  const trusted={...w.trusted,footerText,body:w.trusted.answerText+footerText,logicalBody:'Independent host logical text',checkoutUrl:'opaque-host-context'};
  const plan=buildRecoveryCompositeImagePlanV2({image:w.image,trusted},hash);
  assert.equal(plan.body,trusted.answerText+footerText);assert.deepEqual(parseRecoveryCompositeImagePlanV2(plan,trusted,hash),plan);
  const carrier=buildRecoveryCompositeMultipartDeliveryPlanV2({plan,trusted},hash);
  assert.deepEqual(parseRecoveryCompositeMultipartDeliveryPlanV2(carrier,{checkoutUrl:'legacy-context-only',compositeV2:trusted},hash),carrier);
 }
});

test('obsolete fixed composite format is rejected; exact host caption and logical bytes are independently bound',async()=>{
 const w=await wire();const carrier=buildRecoveryCompositeMultipartDeliveryPlanV2({plan:w.plan,trusted:w.trusted},hash);
 const obsolete={...carrier,parts:[{role:'HEADER',plan:{...w.plan,schemaVersion:1}}]};
 assert.equal(RecoveryCompositeMultipartDeliveryPlanV2Schema.safeParse(obsolete).success,false);
 const trusted={...w.trusted,body:'Host caption independent of metadata',logicalBody:'Host logical text independent of caption'};
 const plan=buildRecoveryCompositeImagePlanV2({image:w.image,trusted},hash);assert.equal(plan.body,trusted.body);
 assert.throws(()=>parseRecoveryCompositeImagePlanV2(plan,{...trusted,body:trusted.body+'!'},hash));
 assert.throws(()=>parseRecoveryCompositeImagePlanV2(plan,{...trusted,logicalBody:trusted.logicalBody+'!'},hash));
});
