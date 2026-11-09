import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CommerceProductSchema } from '../schemas.js';
import { exampleFinal } from '../fixtures.js';
import { verifyCommerceProductFacts } from './facts.js';
import { buildConversationDeliveryPlan, chooseConversationProductImageSource, ConversationDeliveryPlanSchema, ConversationPreparedProductImageSchema, ConversationProductImageBindingSchema, digestConversationDeliveryPlan, readPreparedWrapper, renderPreparedWrapper, stableJson, composeCommerceWhatsAppPreview, type PreparedWrapper, type CommerceVerifiedPresentation } from './index.js';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const pair={productId:'30',variantId:null};
const binding=ConversationProductImageBindingSchema.parse({variable:'response.productImage',placement:'BEFORE_BODY',optional:true});
const image=ConversationPreparedProductImageSchema.parse({schemaVersion:1,shopId:'shop',...pair,publicUrl:'https://media.example/image.jpg',objectKey:`conversation-products/v1/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`,contentSha256:'c'.repeat(64),contentType:'image/jpeg',byteLength:500,width:1125,height:600});
const product=(p:{productId:string;variantId:string|null}=pair,imageUrl:string|null='https://merchant.example/tree.jpg')=>CommerceProductSchema.parse({...p,title:'Tree',url:null,available:true,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:'2026-11-09T12:00:00Z',imageUrl});
const source=(products=[product()],displayedPairs:{productId:string;variantId:string|null}[]=[pair],platform:'SHOPIFY'|'WOOCOMMERCE'='WOOCOMMERCE')=>({shopId:'shop',platform,displayedPairs,verifiedProducts:{shopId:'shop',platform,products}});
const plan=(overrides:Record<string,unknown>={})=>buildConversationDeliveryPlan({body:'Verified answer',binding,image,shopId:'shop',displayedPairs:[pair],...overrides});
test('strict image schemas retain exact limits and reject model fields/unsafe shape',()=>{
 for(const bad of [{...binding,optional:false},{...binding,placement:'INLINE'},{...binding,url:'https://model.example'},{...binding,extra:1}])assert.equal(ConversationProductImageBindingSchema.safeParse(bad).success,false);
 for(const bad of [{...image,byteLength:5*1024*1024},{...image,width:1},{...image,publicUrl:'http://x.example'},{...image,contentSha256:'X'.repeat(64)},{...image,objectKey:'outreach-products/key.jpg'}])assert.equal(ConversationPreparedProductImageSchema.safeParse(bad).success,false);
 assert.equal(ConversationPreparedProductImageSchema.safeParse({...image,byteLength:5*1024*1024-1}).success,true);
});
test('both platforms, exact variant and Woo simple provenance; never use later product',()=>{
 for(const platform of ['SHOPIFY','WOOCOMMERCE'] as const){
  const selected={productId:platform==='SHOPIFY'?'gid://shopify/Product/30':'30',variantId:platform==='SHOPIFY'?'gid://shopify/ProductVariant/31':'31'};
  const result=chooseConversationProductImageSource(source([product(selected)],[selected],platform));
  assert.deepEqual(result,{kind:'SOURCE',shopId:'shop',platform,...selected,sourceUrl:'https://merchant.example/tree.jpg'});
 }
 assert.equal(chooseConversationProductImageSource(source()).kind,'SOURCE');
 const second={productId:'10',variantId:null};
 for(const url of [null,'bad','http://merchant.example/tree'])assert.deepEqual(chooseConversationProductImageSource(source([product(pair,url),product(second)],[pair,second])),{kind:'OMITTED',reason:'NO_PRODUCT_IMAGE'});
 assert.deepEqual(chooseConversationProductImageSource(source([],[])),{kind:'OMITTED',reason:'NO_PRESENTED_PRODUCT'});
 assert.deepEqual(chooseConversationProductImageSource(source([product(second)])),{kind:'OMITTED',reason:'PRODUCT_NOT_VERIFIED'});
 for(const input of [{...source(),shopId:'foreign'},{...source(),platform:'SHOPIFY' as const},source([product(),product()]),source([product()],[pair,pair])])assert.throws(()=>chooseConversationProductImageSource(input),{code:'PRODUCT_IMAGE_IDENTITY_INVALID'});
});
test('delivery precedence, exact identity and Unicode caption/body boundaries preserve full text',()=>{
 assert.equal(plan().plan.kind,'IMAGE');
 for(const [overrides,reason] of [[{binding:undefined},'BINDING_DISABLED'],[{displayedPairs:[],body:'a'.repeat(1025)},'NO_PRESENTED_PRODUCT'],[{body:'a'.repeat(1025),image:null},'CAPTION_TOO_LONG'],[{image:null},'IMAGE_UNAVAILABLE'],[{image:{...image,shopId:'foreign'}},'IMAGE_IDENTITY_MISMATCH'],[{image:{...image,variantId:'other'}},'IMAGE_IDENTITY_MISMATCH']] as const){const result=plan(overrides);assert.equal(result.mediaOmission,reason);assert.equal(result.plan.kind,'TEXT');assert.equal(result.plan.body,overrides.body??'Verified answer');}
 assert.equal(plan({body:'😀'.repeat(1024)}).plan.kind,'IMAGE');
 assert.equal(plan({body:'😀'.repeat(1025)}).mediaOmission,'CAPTION_TOO_LONG');
 assert.equal(plan({body:'x'.repeat(4096)}).plan.body.length,4096);
 assert.throws(()=>plan({body:'x'.repeat(4097)}));assert.throws(()=>plan({body:'bad\u0000'}));assert.throws(()=>plan({binding:null}),{code:'PREPARED_INVALID'});
 assert.equal(ConversationDeliveryPlanSchema.safeParse({schemaVersion:1,kind:'IMAGE',body:'😀'.repeat(1025),image}).success,false);
 const result=plan().plan;assert.equal(digestConversationDeliveryPlan(result,hash),hash(stableJson(result)));assert.notEqual(digestConversationDeliveryPlan(result,hash),digestConversationDeliveryPlan(plan({image:{...image,contentSha256:'d'.repeat(64)}}).plan,hash));
});
const prepared:PreparedWrapper={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[]};
test('optional protected binding preserves legacy hashes and refuses tampering',()=>{
 const legacy=readPreparedWrapper({schemaVersion:1,prepared},hash(stableJson(prepared)),hash);assert.equal(legacy.kind,'ok');if(legacy.kind==='ok'){assert.deepEqual(legacy.prepared,prepared);assert.equal(Object.hasOwn(legacy.prepared,'productImage'),false);}
 const enabled={...prepared,productImage:binding};const read=readPreparedWrapper({schemaVersion:1,prepared:enabled},hash(stableJson(enabled)),hash);assert.equal(read.kind,'ok');if(read.kind==='ok')assert.deepEqual(read.prepared,enabled);
 for(const value of [null,[binding,binding],{...binding,placement:'AFTER_BODY'},{...binding,optional:false},{...binding,sourceUrl:'https://model.example'}]){const invalid={...prepared,productImage:value};assert.equal(readPreparedWrapper({schemaVersion:1,prepared:invalid},hash(stableJson(invalid)),hash).kind,'invalid');}
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared:enabled},hash(stableJson(prepared)),hash).kind,'invalid');
 assert.deepEqual(renderPreparedWrapper({prepared:enabled,context:{conversationId:'c',shopId:'shop',conversationLanguageTag:'en',merchantLanguageTag:null,variables:{},checkoutAvailable:false},responseBody:'Complete answer'}),{kind:'rendered',body:'Complete answer'});
});
const base:CommerceVerifiedPresentation={schemaVersion:1,brandName:null,locale:'en',disposition:'STANDARD',storeUrl:'https://shop.example',products:[],optionFacts:[],productFacts:[],requiresShipping:null,policyUrl:null,includeNoVerifiedOffer:false};
test('explicit AGENT keeps complete normalized prose after selected fact validation; legacy stays deterministic',()=>{
 const facts=verifyCommerceProductFacts([pair],[product()]);if(facts.kind!=='verified')throw Error('fixture');
 const presentation={...base,disposition:'PRODUCT_DETAILS' as const,productFacts:facts.productFacts};
 const envelope={...exampleFinal,answerKind:'ANSWER' as const,referralReason:null,replyText:'**Our tree** fits your garden. Here is what we verified.',details:{productDetailSelections:[pair]}};
 const agent=composeCommerceWhatsAppPreview({envelope,presentation,responseStyle:'AGENT'});assert.equal(agent.kind,'ready');if(agent.kind==='ready'){assert.equal(agent.body,'Our tree fits your garden. Here is what we verified.');assert.equal(agent.candidates.length,1);}
 const legacy=composeCommerceWhatsAppPreview({envelope,presentation});assert.equal(legacy.kind,'ready');if(legacy.kind==='ready')assert.notEqual(legacy.body,agent.kind==='ready'?agent.body:'');
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,details:{productDetailSelections:[{productId:'foreign',variantId:null}]}},presentation,responseStyle:'AGENT'}).kind,'refused');
 for(const disposition of ['STANDARD','OUT_OF_SCOPE_REDIRECT','SHIPPING_INFORMATION_UNVERIFIED'] as const){const r=composeCommerceWhatsAppPreview({envelope:{...envelope,details:{}},presentation:{...base,disposition},responseStyle:'AGENT'});assert.equal(r.kind,'ready');if(r.kind==='ready')assert.equal(r.body,'Our tree fits your garden. Here is what we verified.');}
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'x'.repeat(4097)},presentation,responseStyle:'AGENT'}).kind,'refused');
});

test('AGENT options and recommendations preserve prose; invalid mixed selection refuses',()=>{
 const envelope={...exampleFinal,answerKind:'ANSWER' as const,referralReason:null,replyText:'We have a finish that suits your project.',details:{productOptionSelections:[pair]}};
 const options={...base,disposition:'PRODUCT_OPTIONS' as const,optionFacts:[{...pair,title:'Varnish',options:{status:'AVAILABLE' as const,items:[{name:'Finish',values:['Matte'],usedForVariants:false}]},selectedOptions:[]}]};
 const result=composeCommerceWhatsAppPreview({envelope,presentation:options,responseStyle:'AGENT'});assert.equal(result.kind,'ready');if(result.kind==='ready')assert.equal(result.body,envelope.replyText);
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,details:{productOptionSelections:[pair],productDetailSelections:[pair]}},presentation:options,responseStyle:'AGENT'}).kind,'refused');
 const rec={...base,products:[{title:'Varnish',url:'https://shop.example/varnish',quantity:1,scope:'PRODUCT_ONLY' as const,currentPrice:'12.00',currency:'GBP'}]};
 const r=composeCommerceWhatsAppPreview({envelope:{...envelope,details:{}},presentation:rec,responseStyle:'AGENT'});assert.equal(r.kind,'ready');if(r.kind==='ready')assert.equal(r.body,envelope.replyText);
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'bad\u0000',details:{}},presentation:base,responseStyle:'AGENT'}).kind,'refused');
 assert.deepEqual(chooseConversationProductImageSource(source([product({productId:pair.productId,variantId:'different'})])),{kind:'OMITTED',reason:'PRODUCT_NOT_VERIFIED'});
});

test('foreign provenance is rejected before product image access',()=>{
 let reads=0;const p={...product()};Object.defineProperty(p,'imageUrl',{enumerable:true,get(){reads++;throw Error('URL accessed before identity');}});
 assert.throws(()=>chooseConversationProductImageSource({...source([p]),shopId:'foreign'}),{code:'PRODUCT_IMAGE_IDENTITY_INVALID'});
 assert.equal(reads,0);
});
