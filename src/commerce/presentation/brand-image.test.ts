import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConversationBrandImageOriginSchema, ConversationPreparedBrandImageSchema, ConversationBrandImageDeliveryPlanSchema, ConversationMediaDeliveryPlanSchema, buildConversationBrandImageDeliveryPlan, digestConversationMediaDeliveryPlan, ConversationDeliveryPlanSchema, ConversationPreparedProductImageSchema, digestConversationDeliveryPlan, stableJson } from './index.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const origin={kind:'SHOP_BRAND' as const,shopId:'shop-1',shopDomain:'shop.example',role:'LOGO' as const,sourceGeneration:2,sourceFingerprint:`sha256:${'a'.repeat(64)}`};
const image={schemaVersion:1 as const,origin,status:'READY' as const,kind:'R2_DERIVATIVE' as const,publicOrigin:'https://media.example',publicUrl:`https://media.example/shop-brands/shop.example/logo/sha256-${'b'.repeat(64)}.jpg`,objectKey:`shop-brands/shop.example/logo/sha256-${'b'.repeat(64)}.jpg`,contentSha256:'b'.repeat(64),contentType:'image/jpeg' as const,sizeBytes:500,width:1125 as const,height:600 as const,verifiedAt:'2026-11-12T19:00:00.000Z'};
const text={schemaVersion:1 as const,kind:'TEXT' as const,body:'Shop name\nhttps://shop.example\nAnswer\nhttps://shop.example/checkout'};
const build=(overrides:Record<string,unknown>={})=>buildConversationBrandImageDeliveryPlan({plan:text,origin,publicOrigin:image.publicOrigin,image,...overrides});
test('brand image has honest separate provenance; legacy product contract never widens',()=>{
 const result=build();assert.equal(result.plan.kind,'BRAND_IMAGE');assert.equal(result.plan.body,text.body);
 assert.equal(ConversationDeliveryPlanSchema.safeParse(result.plan).success,false);
 assert.equal(ConversationPreparedProductImageSchema.safeParse(image).success,false);
 assert.equal(ConversationPreparedBrandImageSchema.safeParse({...image,productId:'fake',variantId:null}).success,false);
 assert.equal(ConversationMediaDeliveryPlanSchema.safeParse(result.plan).success,true);
 assert.equal(ConversationBrandImageOriginSchema.safeParse({...origin,productId:'fake'}).success,false);
});
test('strict media/key/URL constraints reject unsafe and cross-shape tampering',()=>{
 for(const change of [{publicUrl:'http://media.example/a'},{publicUrl:'https://u:p@media.example/a'},{publicOrigin:'https://media.example:8443'},{publicOrigin:'https://media.example:443'},{publicOrigin:'bad'},{publicUrl:image.publicUrl+'?x=1'},{publicUrl:image.publicUrl+'#x'},{publicUrl:image.publicUrl+'\n'},{objectKey:'shop-brands/other/logo/a.jpg'},{contentSha256:'c'.repeat(64)},{origin:{...origin,role:'SQUARE_LOGO'}},{origin:{...origin,shopDomain:'../foreign'}},{origin:{...origin,sourceGeneration:0}},{origin:{...origin,sourceFingerprint:'a'.repeat(64)}},{sizeBytes:5*1024*1024},{width:100},{verifiedAt:'bad'},{verifiedAt:'2026-11-12T19:00:00.'+'0'.repeat(65)+'Z'},{extra:true}]){
  assert.doesNotThrow(()=>ConversationPreparedBrandImageSchema.safeParse({...image,...change}));
  assert.equal(ConversationPreparedBrandImageSchema.safeParse({...image,...change}).success,false,JSON.stringify(change));
 }
 for(const field of Object.keys(image)){const missing:any={...image};delete missing[field];assert.equal(ConversationPreparedBrandImageSchema.safeParse(missing).success,false);}
});
test('fresh tenant/domain/role/generation/fingerprint and public origin must match; retain complete text',()=>{
 for(const current of [{...origin,shopId:'foreign'},{...origin,shopDomain:'other.example'},{...origin,role:'SQUARE_LOGO'},{...origin,sourceGeneration:3},{...origin,sourceFingerprint:`sha256:${'c'.repeat(64)}`}]){
  const result=build({origin:current});assert.equal(result.plan.kind,'TEXT');assert.equal(result.plan.body,text.body);assert.equal(result.mediaOmission,'IMAGE_IDENTITY_MISMATCH');
 }
 for(const change of [{image:null},{image:{...image,publicUrl:'bad'}},{publicOrigin:'https://other.example'}]){const result=build(change);assert.equal(result.plan.kind,'TEXT');assert.equal(result.plan.body,text.body);}
});
test('single image priority and Unicode caption fallback never truncate a checkout URL',()=>{
 const product={schemaVersion:1 as const,shopId:'shop-1',productId:'30',variantId:null,publicUrl:'https://media.example/product.jpg',objectKey:`conversation-products/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`,contentSha256:'c'.repeat(64),contentType:'image/jpeg' as const,byteLength:500,width:1125 as const,height:600 as const};
 const legacy=ConversationDeliveryPlanSchema.parse({...text,kind:'IMAGE',image:product});
 assert.deepEqual(build({plan:legacy}).plan,legacy);assert.equal(build({plan:legacy}).mediaOmission,'PRODUCT_IMAGE_PRIORITY');
 assert.equal(build({plan:{...text,body:'😀'.repeat(1024)}}).plan.kind,'BRAND_IMAGE');
 const body='😀'.repeat(1025)+'\nhttps://shop.example/checkout';const result=build({plan:{...text,body}});assert.equal(result.mediaOmission,'CAPTION_TOO_LONG');assert.equal(result.plan.body,body);
 assert.equal(ConversationBrandImageDeliveryPlanSchema.safeParse({...text,kind:'BRAND_IMAGE',body,image}).success,false);
});
test('canonical generic digest preserves legacy bytes and binds every brand field',()=>{
 assert.equal(digestConversationMediaDeliveryPlan(text,sha),digestConversationDeliveryPlan(text,sha));
 const plan=build().plan;assert.equal(digestConversationMediaDeliveryPlan(plan,sha),sha(stableJson(plan)));
 assert.notEqual(digestConversationMediaDeliveryPlan(plan,sha),digestConversationMediaDeliveryPlan({...plan,body:'Different'},sha));
 const png={...image,contentType:'image/png' as const,objectKey:image.objectKey.replace(/jpg$/,'png'),publicUrl:image.publicUrl.replace(/jpg$/,'png')};
 assert.ok(ConversationPreparedBrandImageSchema.safeParse(png).success);
 assert.notEqual(digestConversationMediaDeliveryPlan(plan,sha),digestConversationMediaDeliveryPlan({...text,kind:'BRAND_IMAGE',image:png},sha));
});
test('all existing brand roles and encoded media types preserve exact canonical identity',()=>{
 for(const role of ['LOGO','SQUARE_LOGO','COVER_IMAGE'] as const)for(const contentType of ['image/jpeg','image/png'] as const){
  const extension=contentType==='image/jpeg'?'jpg':'png';const objectKey=`shop-brands/shop.example/${role.toLowerCase()}/sha256-${image.contentSha256}.${extension}`;
  const next={...image,origin:{...origin,role},contentType,objectKey,publicUrl:`${image.publicOrigin}/${objectKey}`};
  assert.ok(ConversationPreparedBrandImageSchema.safeParse(next).success);
 }
 const plan=build().plan;
 if(plan.kind!=='BRAND_IMAGE')throw new Error('expected brand plan');
 for(const next of [{...image,sizeBytes:501},{...image,verifiedAt:'2026-11-12T19:01:00.000Z'},{...image,origin:{...origin,sourceGeneration:3}},{...image,origin:{...origin,sourceFingerprint:`sha256:${'c'.repeat(64)}`}}])
  assert.notEqual(digestConversationMediaDeliveryPlan(plan,sha),digestConversationMediaDeliveryPlan({...plan,image:next},sha));
 for(const body of ['', '   ', 'bad\u0000'])assert.equal(ConversationBrandImageDeliveryPlanSchema.safeParse({...plan,body}).success,false);
});
