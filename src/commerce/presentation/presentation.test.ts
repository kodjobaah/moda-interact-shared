import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CommerceVerifiedPresentationSchema, composeCommerceWhatsAppPreview, normalizeCommerceReplyText, verifyCommerceOptionFacts, renderRecommendationReply, readPreparedWrapper, renderPreparedWrapper, stableJson, chooseSlot, languageChoices, productOptionMessages, type CommerceVerifiedPresentation, type WrapperSlot, type PreparedWrapper, type VerifiedWrapperContext } from './index.js';
import type { CommerceFinalResponse } from '../response.js';
import { MODA_SUPPORTED_LANGUAGE_TAGS } from '../../internationalization.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const envelope:CommerceFinalResponse={answerKind:'ANSWER',replyText:'Hello **there**',referralReason:null,detectedLanguageTag:null,detectedLanguageConfidence:null,evidenceIds:[],details:{}};
const projection:CommerceVerifiedPresentation={schemaVersion:1,brandName:'Saved shop',locale:'en',disposition:'STANDARD',storeUrl:'https://shop.example',products:[],optionFacts:[],requiresShipping:null,policyUrl:null,includeNoVerifiedOffer:false};
const context:VerifiedWrapperContext={conversationId:'c',shopId:'s',conversationLanguageTag:'en',merchantLanguageTag:'fr',variables:{'shop.name':'Saved shop','customer.firstName':'Test customer'},checkoutAvailable:false};
function wrapper(prefix='Welcome'): {slots:WrapperSlot[];context:VerifiedWrapperContext;digest:typeof hash} {
 const prepared:PreparedWrapper={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'text',value:prefix}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'}]}]};
 const locale={id:'locale',languageTag:'en',status:'SOURCE_SAVED',providerLanguageCode:null,localeAst:{schemaVersion:1,prepared},contentHash:hash(stableJson(prepared)),reviewedAt:null,reviewedByAdminId:null};
 const definition={id:'definition',kind:'MODA_CONVERSATION_WRAPPER',audience:'AI',status:'PUBLISHED',sourceLanguageTag:'en',astSchemaVersion:1,sourceHash:'a'.repeat(64),publishedAt:new Date(0),retiredAt:null,createdByAdminId:'admin',locales:[locale]};
 return {slots:[{audience:'AI',definitionId:'definition',editVersion:3,definition}],context,digest:hash};
}
test('legacy golden recommendations preserve20 locales/prices/offers/shipping byte for byte',()=>{
 const golden=JSON.parse(readFileSync(new URL('./legacy-golden.json',import.meta.url),'utf8')) as {fixtures:Array<{input:Parameters<typeof renderRecommendationReply>[0];body:string}>};
 assert.equal(golden.fixtures.length,60);for(const f of golden.fixtures)assert.equal(renderRecommendationReply(f.input),f.body);
 assert.deepEqual(Object.keys(productOptionMessages).sort(),[...MODA_SUPPORTED_LANGUAGE_TAGS].sort());
});
test('plain text balanced formatting, safe links, Unicode, inert HTML, unmatched markers',()=>{
 assert.equal(normalizeCommerceReplyText('**Bold**\n~~sale~~ [Shop](https://shop.example/a) *native* **unmatched'),'Bold\nsale Shop: https://shop.example/a *native* **unmatched');
 assert.equal(normalizeCommerceReplyText('[bad](https://user:pass@shop.example/a) <script>alert(1)</script>'), '[bad](https://user:pass@shop.example/a) <script>alert(1)</script>');
 assert.equal(normalizeCommerceReplyText('😀 **€10** ~~old~~'),'😀 €10 old');
 assert.equal(normalizeCommerceReplyText('https://shop.example/a**native** **text**'),'https://shop.example/a**native** text');
});
test('wrapper golden render/hash/provenance and checkout omission preserve existing rules',()=>{
 const w=wrapper();const result=composeCommerceWhatsAppPreview({envelope,presentation:projection,wrapper:w});
 assert.equal(result.kind,'ready');if(result.kind==='ready'){assert.equal(result.body,'Welcome\nHello there');assert.deepEqual(result.wrapper,{definitionId:'definition',localeId:'locale',contentHash:w.slots[0]!.definition.locales[0]!.contentHash,slotEditVersion:3});}
 const locale=w.slots[0]!.definition.locales[0]!;const read=readPreparedWrapper(locale.localeAst,locale.contentHash,hash);assert.equal(read.kind,'ok');if(read.kind==='ok')assert.deepEqual(renderPreparedWrapper({prepared:read.prepared,context,responseBody:'Reply'}),{kind:'rendered',body:'Welcome\nReply'});
});
test('missing wrapper explicit unwrapped; HUMAN-only no AI slot; invalid configured wrapper refuses',()=>{
 assert.deepEqual(composeCommerceWhatsAppPreview({envelope,presentation:projection}),{kind:'ready',body:'Hello there',candidates:['Hello there'],wrapper:null});
 const human=wrapper();human.slots[0]={...human.slots[0]!,audience:'HUMAN'};assert.equal(composeCommerceWhatsAppPreview({envelope,presentation:projection,wrapper:human}).kind,'ready');
 const invalid=wrapper();invalid.slots[0]!.definition.locales[0]!.contentHash;const broken={...invalid,slots:[{...invalid.slots[0]!,definition:{...invalid.slots[0]!.definition,status:'RETIRED'}}]};assert.deepEqual(composeCommerceWhatsAppPreview({envelope,presentation:projection,wrapper:broken}),{kind:'refused',reason:'DEFINITION_UNAVAILABLE'});
});
test('4096/4097 UTF16 including wrapper; complete candidate selection without splitting',()=>{
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'x'.repeat(4096)},presentation:projection}).kind,'ready');
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'x'.repeat(4097)},presentation:projection}).kind,'refused');
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'x'.repeat(4094)},presentation:projection,wrapper:wrapper('a')}).kind,'ready');
 assert.deepEqual(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'x'.repeat(4095)},presentation:projection,wrapper:wrapper('a')}),{kind:'refused',reason:'OUTPUT_TOO_LONG'});
 assert.equal(composeCommerceWhatsAppPreview({envelope:{...envelope,replyText:'😀'.repeat(2048)},presentation:projection}).kind,'ready');
 const products=Array.from({length:3},()=>({title:'a'.repeat(512),url:'https://shop.example/products/'+ 'x'.repeat(900),quantity:1,scope:'PRODUCT_ONLY' as const,currentPrice:null,currency:null}));
 const result=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,products},wrapper:wrapper('a'.repeat(100))});assert.equal(result.kind,'ready');if(result.kind==='ready'){assert.ok(result.body.length<=4096);assert.ok(result.candidates.length<=3);assert.ok(result.body.includes(products[0]!.url));}
});
test('projection rejects foreign/credential URLs and remains strict',()=>{
 assert.equal(CommerceVerifiedPresentationSchema.safeParse({...projection,policyUrl:'https://foreign.example/policy'}).success,false);
 assert.equal(CommerceVerifiedPresentationSchema.safeParse({...projection,storeUrl:'https://user:pass@shop.example'}).success,false);
 assert.equal(CommerceVerifiedPresentationSchema.safeParse({...projection,extra:'bad'}).success,false);
});
test('option facts use exact current IDs only; missing and duplicate reads produce typed limitations',()=>{
 const p={productId:'1',variantId:null,title:'Native size',url:null,available:null,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:new Date(0).toISOString(),options:{status:'PARTIAL',items:[{name:'Taille',values:['M','L'],usedForVariants:true}]},selectedOptions:[]};
 const selected=verifyCommerceOptionFacts([{productId:'1',variantId:null}],[p]);assert.equal(selected.kind,'verified');if(selected.kind==='verified'){const result=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,disposition:'PRODUCT_OPTIONS',optionFacts:selected.optionFacts}});assert.equal(result.kind,'ready');if(result.kind==='ready'){assert.match(result.body,/incomplete/);assert.match(result.body,/Taille: M, L/);assert.ok(!result.body.includes('available sizes'));}}
 assert.deepEqual(verifyCommerceOptionFacts([{productId:'2',variantId:null}],[p]),{kind:'limitation',reason:'PRODUCT_NOT_FOUND'});
 assert.equal(verifyCommerceOptionFacts([{productId:'1',variantId:null}],[p,p]).kind,'limitation');
 const {options:ignored,...legacy}=p;const unknown=verifyCommerceOptionFacts([{productId:'1',variantId:null}],[legacy]);assert.equal(unknown.kind,'verified');if(unknown.kind==='verified')assert.equal(unknown.optionFacts[0]!.options.status,'PARTIAL');
 for(const locale of MODA_SUPPORTED_LANGUAGE_TAGS){const r=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,locale,disposition:'PRODUCT_OPTIONS'}});assert.equal(r.kind,'ready');if(r.kind==='ready')assert.equal(r.body,productOptionMessages[locale][0]);}
});
test('referral cannot be converted into verified recommendation or options answer',()=>{
 const result=composeCommerceWhatsAppPreview({envelope:{...envelope,answerKind:'REFER_TO_STORE',referralReason:'TOOL_REVOKED',replyText:'Check **store**'},presentation:{...projection,disposition:'PRODUCT_OPTIONS'}});assert.equal(result.kind,'ready');if(result.kind==='ready')assert.equal(result.body,'Check store');
});
test('prepared projection rejects zero/multiple/misplaced slots, wrong hashes and token markers',()=>{
 const w=wrapper();const prepared=(w.slots[0]!.definition.locales[0]!.localeAst as {prepared:PreparedWrapper}).prepared;
 for(const body of [[],[...prepared.body,...prepared.body]]){const bad={...prepared,body};assert.equal(readPreparedWrapper({schemaVersion:1,prepared:bad},hash(stableJson(bad)),hash).kind,'invalid');}
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared},'f'.repeat(64),hash).kind,'invalid');
 const bad={...prepared,header:[{kind:'text',value:'{{customer.firstName}}'}]};assert.equal(readPreparedWrapper({schemaVersion:1,prepared:bad},hash(stableJson(bad)),hash).kind,'invalid');
 assert.equal(chooseSlot([...w.slots,...w.slots],'AI'),'invalid');
 assert.equal(languageChoices({conversationTag:'fr-CA',merchantTag:'en',preferredTag:'de',platformFallbackTag:'en'}),'invalid');
});
test('controls, already wrapped and unavailable required variables refuse; optional checkout omitted',()=>{
 const w=wrapper();const locale=w.slots[0]!.definition.locales[0]!;const read=readPreparedWrapper(locale.localeAst,locale.contentHash,hash);if(read.kind!=='ok')throw Error();
 assert.deepEqual(renderPreparedWrapper({prepared:read.prepared,context,responseBody:'Welcome\nreply'}),{kind:'rejected',reason:'ALREADY_WRAPPED'});
 assert.deepEqual(renderPreparedWrapper({prepared:read.prepared,context,responseBody:'bad\u0000'}),{kind:'rejected',reason:'INVALID_INPUT'});
 const required={...read.prepared,header:[{kind:'variable' as const,name:'customer.firstName' as const}]};assert.deepEqual(renderPreparedWrapper({prepared:required,context:{...context,variables:{}},responseBody:'reply'}),{kind:'rejected',reason:'VARIABLE_UNAVAILABLE'});
});

test('selection-only option details remain bounded and compose with strict existing schemas',async()=>{
 const {CommerceAnswerPresentationSelectionSchema}=await import('../schemas.js');
 assert.ok(CommerceAnswerPresentationSelectionSchema.safeParse({responseDisposition:'PRODUCT_OPTIONS',productOptionSelections:[{productId:'1',variantId:null}]}).success);
 assert.equal(CommerceAnswerPresentationSelectionSchema.safeParse({productOptionSelections:Array.from({length:4},()=>({productId:'1',variantId:null}))}).success,false);
 assert.equal(CommerceAnswerPresentationSelectionSchema.safeParse({productOptionSelections:[{productId:'1',variantId:null,options:{}}]}).success,false);
});

test('regional locale selects same-language reviewed fallback with no English replacement',()=>{
 const w=wrapper();const source=w.slots[0]!.definition.locales[0]!;
 const locale={...source,id:'fr-locale',languageTag:'fr',status:'REVIEWED',reviewedAt:new Date(0),reviewedByAdminId:'reviewer'};
 const regional={...w,context:{...context,conversationLanguageTag:'fr-CA'},slots:[{...w.slots[0]!,definition:{...w.slots[0]!.definition,locales:[source,locale]}}]};
 const result=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,locale:'fr',disposition:'PRODUCT_OPTIONS'},wrapper:regional});
 assert.equal(result.kind,'ready');if(result.kind==='ready'){assert.equal(result.wrapper?.localeId,'fr-locale');assert.match(result.body,/Les détails/);}
});

test('wrapper variable2048 bound and compiled-control rejection',()=>{
 const w=wrapper();const locale=w.slots[0]!.definition.locales[0]!;const read=readPreparedWrapper(locale.localeAst,locale.contentHash,hash);if(read.kind!=='ok')throw Error();
 const prepared={...read.prepared,header:[{kind:'variable' as const,name:'shop.name' as const}]};
 assert.equal(renderPreparedWrapper({prepared,context:{...context,variables:{'shop.name':'x'.repeat(2048)}},responseBody:'reply'}).kind,'rendered');
 assert.deepEqual(renderPreparedWrapper({prepared,context:{...context,variables:{'shop.name':'x'.repeat(2049)}},responseBody:'reply'}),{kind:'rejected',reason:'VARIABLE_UNAVAILABLE'});
 assert.deepEqual(renderPreparedWrapper({prepared:{...read.prepared,header:[{kind:'text',value:'bad\u0000'}]},context,responseBody:'reply'}),{kind:'rejected',reason:'PREPARED_INVALID'});
});

test('PRODUCT_DETAILS uses existing wrapper selection and complete minimal candidate bounds',async()=>{
 const {verifyCommerceProductFacts,productFactMessages}=await import('./index.js');
 const p={productId:'facts',variantId:null,title:'Native facts',url:null,available:null,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:new Date(0).toISOString(),description:{status:'AVAILABLE',text:'Detailed merchant facts'},attributes:{status:'AVAILABLE',items:[{name:'Custom units',values:['2 ml']}]},options:{status:'NOT_PROVIDED',items:[]},selectedOptions:[]};
 const verified=verifyCommerceProductFacts([{productId:'facts',variantId:null}],[p]);assert.equal(verified.kind,'verified');if(verified.kind!=='verified')return;
 const result=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,disposition:'PRODUCT_DETAILS',productFacts:verified.productFacts},wrapper:wrapper()});assert.equal(result.kind,'ready');if(result.kind==='ready'){assert.ok(result.body.startsWith('Welcome\nNative facts'));assert.equal(result.wrapper?.definitionId,'definition');}
 verified.productFacts[0]!.description={status:'PARTIAL',text:'😀'.repeat(4096)};
 const minimal=composeCommerceWhatsAppPreview({envelope,presentation:{...projection,disposition:'PRODUCT_DETAILS',productFacts:verified.productFacts},wrapper:wrapper()});assert.equal(minimal.kind,'ready');if(minimal.kind==='ready'){assert.equal(minimal.body,'Welcome\n'+productFactMessages.en[0]);assert.ok(minimal.body.length<=4096);}
});
