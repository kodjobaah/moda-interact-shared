import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MAX_RECOVERY_DELIVERY_PARTS, RecoveryMultipartDeliveryPartSchema, RecoveryMultipartDeliveryPlanSchema,
  buildRecoveryMultipartDeliveryPlan, parseRecoveryMultipartDeliveryPlan, digestRecoveryMultipartDeliveryPlan,
  ConversationDeliveryPlanSchema, ConversationMediaDeliveryPlanSchema, digestConversationMediaDeliveryPlan,
  digestConversationDeliveryPlan, stableJson, type RecoveryMultipartDeliveryPart,
} from './index.js';
const checkoutUrl = 'https://shop.example/checkouts/recover?key=synthetic&locale=en';
const footer = `\n\n──────────\n${checkoutUrl}`;
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const productImage = {schemaVersion:1 as const,shopId:'shop-1',productId:'30',variantId:null,publicUrl:'https://media.example/product.jpg',objectKey:`conversation-products/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`,contentSha256:'c'.repeat(64),contentType:'image/jpeg' as const,byteLength:500,width:1125 as const,height:600 as const};
const brandImage = {schemaVersion:1 as const,origin:{kind:'SHOP_BRAND' as const,shopId:'shop-1',shopDomain:'shop.example',role:'LOGO' as const,sourceGeneration:1,sourceFingerprint:`sha256:${'a'.repeat(64)}`},status:'READY' as const,kind:'R2_DERIVATIVE' as const,publicOrigin:'https://media.example',publicUrl:`https://media.example/shop-brands/shop.example/logo/sha256-${'b'.repeat(64)}.jpg`,objectKey:`shop-brands/shop.example/logo/sha256-${'b'.repeat(64)}.jpg`,contentSha256:'b'.repeat(64),contentType:'image/jpeg' as const,sizeBytes:500,width:1125 as const,height:600 as const,verifiedAt:'2026-11-13T00:00:00Z'};
const header: RecoveryMultipartDeliveryPart = {role:'HEADER',plan:{schemaVersion:1,kind:'BRAND_IMAGE',body:`Example shop\nhttps://shop.example${footer}`,image:brandImage}};
const product = (body = `Verified product answer${footer}`): Extract<RecoveryMultipartDeliveryPart,{role:'PRODUCT'}> => ({role:'PRODUCT',plan:{schemaVersion:1,kind:'IMAGE',body,image:productImage}});
const answer = (body = `Complete answer${footer}`): Extract<RecoveryMultipartDeliveryPart,{role:'ANSWER'}> => ({role:'ANSWER',plan:{schemaVersion:1,kind:'TEXT',body}});
const raw = (parts: unknown[]) => ({schemaVersion:1,kind:'RECOVERY_MULTIPART',parts});
const build = (parts: RecoveryMultipartDeliveryPart[]) => buildRecoveryMultipartDeliveryPlan({parts,checkoutUrl});

test('ordered short-answer layout separates logo and product with exact footer on both physical parts', () => {
  assert.equal(MAX_RECOVERY_DELIVERY_PARTS,3);
  const plan = build([header,product()]);
  assert.deepEqual(plan,raw([header,product()]));
  assert.equal(plan.parts[0]!.plan.kind,'BRAND_IMAGE');
  assert.equal(plan.parts[1]!.plan.kind,'IMAGE');
  assert.ok(plan.parts.every(part=>part.plan.body.endsWith(footer)));
});
test('long authored answer is preserved byte for byte in a third TEXT part rather than truncated', () => {
  const authored = `Human text with its own divider ────────── and URL https://other.example/leave-this\n${'Long answer. '.repeat(100)}`;
  const body = authored+footer;
  const plan = build([header,product(`Product photo${footer}`),answer(body)]);
  assert.deepEqual(plan.parts.map(part=>part.role),['HEADER','PRODUCT','ANSWER']);
  assert.equal(plan.parts[2]!.plan.body,body);
  assert.throws(()=>build([header,product(body)]));
});
test('missing logo uses text header, no-product replies and whole TEXT fallback retain full text', () => {
  const textHeader:RecoveryMultipartDeliveryPart = {role:'HEADER',plan:{schemaVersion:1,kind:'TEXT',body:header.plan.body}};
  for(const parts of [[textHeader,product()],[textHeader,answer()],[header,answer()],[answer()]])
    assert.deepEqual(build(parts).parts,parts);
});
test('order is bounded and contiguous by manifest array; duplicate or incomplete roles are refused', () => {
  for(const parts of [[],[header],[product()],[product(),header],[answer(),header],[header,header],[header,product(),product()],[header,answer(),product()],[header,product(),answer(),answer()]])
    assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(raw(parts)).success,false,JSON.stringify(parts.map(part=>part.role)));
  assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse({...raw([answer()]),ordinal:0}).success,false);
  assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse({...raw([answer()]),schemaVersion:2}).success,false);
});
test('roles cannot disguise product media as shop branding or add cover media/fake product provenance', () => {
  for(const part of [{role:'HEADER',plan:product().plan},{role:'PRODUCT',plan:header.plan},{role:'ANSWER',plan:product().plan},{...header,extra:true},{role:'FOOTER',plan:answer().plan}])
    assert.equal(RecoveryMultipartDeliveryPartSchema.safeParse(part).success,false);
  const coverKey=brandImage.objectKey.replace('/logo/','/cover_image/');
  const cover={...brandImage,origin:{...brandImage.origin,role:'COVER_IMAGE'},objectKey:coverKey,publicUrl:`${brandImage.publicOrigin}/${coverKey}`};
  assert.equal(RecoveryMultipartDeliveryPartSchema.safeParse({...header,plan:{...header.plan,image:cover}}).success,false);
  assert.equal(RecoveryMultipartDeliveryPlanSchema.safeParse(raw([header,{role:'PRODUCT',plan:{...product().plan,image:{...productImage,shopId:'foreign'}}}])).success,false);
  assert.equal(RecoveryMultipartDeliveryPartSchema.safeParse({...header,plan:{...header.plan,image:{...brandImage,productId:'fake'}}}).success,false);
});
test('every physical footer must be the host trusted URL on its own exact final line', () => {
  for(const body of ['No footer',`Answer ${checkoutUrl}`,`https://evil.example/${checkoutUrl}`,`Answer\n${checkoutUrl}/other`,`Answer\n${checkoutUrl} `,`Answer\n${checkoutUrl}\n`,`Answer\nhttps://other.example/checkouts/recover`])
    assert.throws(()=>build([header,answer(body)]),{code:'RECOVERY_CHECKOUT_FOOTER_INVALID'});
  assert.throws(()=>build([answer(),{...product(),plan:{...product().plan,body:'No footer'}}]));
  assert.equal(parseRecoveryMultipartDeliveryPlan(raw([answer(checkoutUrl)]),checkoutUrl).parts[0]!.plan.body,checkoutUrl);
  assert.throws(()=>parseRecoveryMultipartDeliveryPlan({...raw([answer()]),checkoutUrl},checkoutUrl));
});
test('the trusted URL is explicit and safe; authority is never extracted from a part body', () => {
  for(const unsafe of ['javascript:alert(1)','http://shop.example/checkout','https://u:p@shop.example/checkout',checkoutUrl+'#fragment',checkoutUrl+'\n','', ' '+checkoutUrl])
    assert.throws(()=>buildRecoveryMultipartDeliveryPlan({parts:[answer()],checkoutUrl:unsafe}));
  assert.throws(()=>parseRecoveryMultipartDeliveryPlan(raw([answer()]),'https://other.example/recover'),{code:'RECOVERY_CHECKOUT_FOOTER_INVALID'});
});
test('caption limits count Unicode codepoints; existing text length contract and authored control protections remain', () => {
  const points=Array.from(footer).length;
  const exact='😀'.repeat(1024-points)+footer;
  assert.equal(Array.from(exact).length,1024);
  assert.equal(build([header,product(exact)]).parts[1]!.plan.body,exact);
  assert.throws(()=>build([header,product('😀'+exact)]));
  const full='x'.repeat(4096-footer.length)+footer;
  assert.equal(build([header,answer(full)]).parts[1]!.plan.body.length,4096);
  assert.throws(()=>build([header,answer('x'+full)]));
  for(const body of ['', '   ', `bad\u0000${footer}`, `bad\u007f${footer}`]) assert.throws(()=>build([answer(body)]));
});
test('multipart is additive and digests bind exact roles, order, bodies and verified media metadata', () => {
  const plan=build([header,product()]);
  assert.equal(ConversationMediaDeliveryPlanSchema.safeParse(plan).success,false);
  assert.equal(ConversationDeliveryPlanSchema.safeParse(plan).success,false);
  const digest=digestRecoveryMultipartDeliveryPlan(plan,hash);
  assert.equal(digest,hash(stableJson(plan)));
  for(const changed of [build([header,answer()]),build([header,product(`Other answer${footer}`)]),build([{...header,plan:{...header.plan,body:`Another shop name${footer}`}},product()])])
    assert.notEqual(digest,digestRecoveryMultipartDeliveryPlan(changed,hash));
  const changedImage={...productImage,byteLength:501};
  assert.notEqual(digest,digestRecoveryMultipartDeliveryPlan(build([header,{role:'PRODUCT',plan:{schemaVersion:1,kind:'IMAGE',body:product().plan.body,image:changedImage}}]),hash));
  const legacy=answer().plan;
  assert.equal(digestConversationMediaDeliveryPlan(legacy,hash),digestConversationDeliveryPlan(ConversationDeliveryPlanSchema.parse(legacy),hash));
});
