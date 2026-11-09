import test from "node:test";
import assert from "node:assert/strict";
import { MODA_SUPPORTED_LANGUAGE_TAGS } from "../../internationalization.js";
import { verifyCommerceProductFacts, renderCommerceProductFacts, CommerceProductFactSchema } from "./facts.js";
import { productFactMessages } from "./fact-messages.js";
import { CommerceVerifiedPresentationSchema } from "./schemas.js";
import { composeCommerceWhatsAppPreview } from "./compose.js";
const product={productId:"1",variantId:null,title:"Merchant product",url:null,available:null,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:new Date(0).toISOString(),description:{status:"AVAILABLE",text:"Native description"},attributes:{status:"AVAILABLE",items:[{name:"Custom label",values:["2 units"]}]},options:{status:"AVAILABLE",items:[{name:"Custom label",values:["2 units"],usedForVariants:false}]},selectedOptions:[]};
const fact=()=>{const result=verifyCommerceProductFacts([{productId:"1",variantId:null}],[product]);assert.equal(result.kind,"verified");if(result.kind!=="verified")throw new Error();return result.productFacts[0]!;};
const presentation={schemaVersion:1 as const,brandName:null,locale:"en" as const,disposition:"PRODUCT_DETAILS" as const,storeUrl:"https://shop.example",products:[],optionFacts:[],requiresShipping:null,policyUrl:null,includeNoVerifiedOffer:false};
const envelope={answerKind:"ANSWER" as const,replyText:"Raw output",referralReason:null,detectedLanguageTag:null,detectedLanguageConfidence:null,evidenceIds:[],details:{}};
test("exact selection rejects duplicate, foreign, ambiguous or malformed products and projects legacy unknown",()=>{
 assert.deepEqual(verifyCommerceProductFacts([{productId:"1",variantId:null},{productId:"1",variantId:null}],[product]),{kind:"limitation",reason:"INVALID_SELECTION"});
 assert.deepEqual(verifyCommerceProductFacts([{productId:"2",variantId:null}],[product]),{kind:"limitation",reason:"PRODUCT_NOT_FOUND"});
 assert.deepEqual(verifyCommerceProductFacts([{productId:"1",variantId:null}],[product,product]),{kind:"limitation",reason:"PRODUCT_NOT_FOUND"});
 assert.deepEqual(verifyCommerceProductFacts([{productId:"1",variantId:null}],[{...product,title:42}]),{kind:"limitation",reason:"PRODUCT_INVALID"});
 const {description:ignored,attributes:ignored2,...legacy}=product;const result=verifyCommerceProductFacts([{productId:"1",variantId:null}],[legacy]);assert.equal(result.kind,"verified");if(result.kind==="verified"){assert.equal(result.productFacts[0]?.description.status,"PARTIAL");assert.equal(result.productFacts[0]?.attributes.status,"PARTIAL");}
});
test("all merchant labels use one generic renderer with no duplicate fact lines",()=>{
 for(const [name,values] of [["Size",["M","L"]],["Shade",["Classic white"]],["Volume",["15 ml"]],["Species",["Acer"]],["Height",["2 m"]],["Pot size",["10 L"]],["Unseen native label",["native unit"]]] as const){const f=fact();f.attributes.items=[{name,values:[...values]}];f.options.items=[{name,values:[...values],usedForVariants:true}];const rendered=renderCommerceProductFacts([f],"en");assert.equal(rendered.split(`${name}:`).length,2);assert.ok(rendered.includes(values.join(", ")));}
 const f=fact();f.selectedOptions=[{name:"Custom label",value:"2 units"}];assert.equal(renderCommerceProductFacts([f],"en").split("Custom label:").length,2);assert.ok(renderCommerceProductFacts([f],"en").includes("Selected options:"));
});
test("localized truthful missing and partial information covers every accepted locale",()=>{
 assert.deepEqual(Object.keys(productFactMessages).sort(),[...MODA_SUPPORTED_LANGUAGE_TAGS].sort());
 const f=fact();f.description={status:"PARTIAL",text:""};f.attributes={status:"PARTIAL",items:[]};f.options={status:"PARTIAL",items:[]};
 for(const locale of MODA_SUPPORTED_LANGUAGE_TAGS){const text=renderCommerceProductFacts([f],locale);assert.ok(text.includes(productFactMessages[locale][0]));assert.equal(text.split(productFactMessages[locale][1]).length,2);}
 assert.equal(CommerceProductFactSchema.safeParse({...f,description:undefined}).success,false);
});
test("PRODUCT_DETAILS is additive, rejects invalid mixtures, retains referral and bounded complete candidates",()=>{
 const f=fact();assert.equal(CommerceVerifiedPresentationSchema.safeParse({...presentation,productFacts:[]}).success,false);
 assert.equal(CommerceVerifiedPresentationSchema.safeParse({...presentation,productFacts:[f],optionFacts:[{productId:f.productId,variantId:f.variantId,title:f.title,options:f.options,selectedOptions:[]}]}).success,false);
 const result=composeCommerceWhatsAppPreview({envelope,presentation:{...presentation,productFacts:[f]}});assert.equal(result.kind,"ready");if(result.kind==="ready")assert.equal(result.body,renderCommerceProductFacts([f],"en"));
 const referral=composeCommerceWhatsAppPreview({envelope:{...envelope,answerKind:"REFER_TO_STORE",referralReason:"TOOL_REVOKED",replyText:"Contact store"},presentation:{...presentation,productFacts:[f]}});assert.equal(referral.kind,"ready");if(referral.kind==="ready")assert.equal(referral.body,"Contact store");
 f.description={status:"PARTIAL",text:"😀".repeat(4096)};const bounded=composeCommerceWhatsAppPreview({envelope,presentation:{...presentation,productFacts:[f,f,f]}});assert.equal(bounded.kind,"ready");if(bounded.kind==="ready"){assert.ok(bounded.body.length<=4096);assert.equal(bounded.body,productFactMessages.en[0]);assert.ok(bounded.candidates.length<=3);}
});

import {CommerceProductStockSchema,normalizeCommerceStockQuantity,CommerceToolOutputs} from '../schemas.js';
import {stockFactMessages} from './fact-messages.js';
import {z} from 'zod';
test('stock normalization is safe, zero distinct and generated product outputs include stock',()=>{
 for(const v of [null,undefined,'3',{},NaN,Infinity,-Infinity,1.2,Number.MAX_SAFE_INTEGER+1])assert.equal(normalizeCommerceStockQuantity(v),null);
 assert.equal(normalizeCommerceStockQuantity(-9),0);assert.equal(normalizeCommerceStockQuantity(0),0);assert.equal(normalizeCommerceStockQuantity(Number.MAX_SAFE_INTEGER),Number.MAX_SAFE_INTEGER);
 assert.equal(CommerceProductStockSchema.safeParse({status:'KNOWN',scope:'VARIANT',quantity:-1}).success,false);
 const output=z.toJSONSchema(CommerceToolOutputs.commerce_get_product);assert.ok(JSON.stringify(output).includes('stock'));assert.ok(JSON.stringify(output).includes('NOT_TRACKED'));
});
test('verified stocks preserve provider observation and deterministic localized exact quantity/scope',()=>{
 for(const stock of [{status:'KNOWN',quantity:0,scope:'VARIANT'},{status:'KNOWN',quantity:123,scope:'PRODUCT'},{status:'NOT_TRACKED'},{status:'UNAVAILABLE'}] as const){
 const r=verifyCommerceProductFacts([{productId:'1',variantId:null}],[{...product,stock}]);assert.equal(r.kind,'verified');if(r.kind!=='verified')throw Error();assert.deepEqual(r.productFacts[0]!.stock,stock);assert.equal(r.productFacts[0]!.observedAt,product.observedAt);
 for(const locale of MODA_SUPPORTED_LANGUAGE_TAGS){const text=renderCommerceProductFacts(r.productFacts,locale);const labels=stockFactMessages[locale];assert.ok(text.includes(stock.status==='KNOWN'?labels[stock.scope==='VARIANT'?1:0]:labels[stock.status==='NOT_TRACKED'?2:3]));if(stock.status==='KNOWN')assert.ok(text.includes(new Intl.NumberFormat(locale).format(stock.quantity)));}
 }
 assert.deepEqual(fact().stock,{status:'UNAVAILABLE'});
 const r=verifyCommerceProductFacts([{productId:'1',variantId:null}],[{...product,stock:{status:'KNOWN',quantity:0,scope:'VARIANT'}}]);if(r.kind!=='verified')throw Error();const composed=composeCommerceWhatsAppPreview({envelope,presentation:{...presentation,productFacts:r.productFacts}});assert.equal(composed.kind,'ready');if(composed.kind==='ready')assert.equal(composed.body,'Merchant product\nStock (selected variant): 0\nNative description\nCustom label: 2 units');
});
