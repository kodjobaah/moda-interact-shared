import test from "node:test";
import assert from "node:assert/strict";
import { mergeConversationProductContext as merge,resolveConversationProductReference as resolve,CommerceConversationProductContextSchema } from "./product-context";
import { CommerceProductSchema,normalizeCommerceProductOptions,CommerceProductSelectedOptionsSchema } from "./schemas";
const now=Date.parse("2026-11-08T00:00:00Z");const identity={shopId:"shop",conversationId:"conversation",platform:"WOOCOMMERCE" as const,now};
const product=(id:string,title="Shirt")=>CommerceProductSchema.parse({productId:id,variantId:null,title,url:null,available:null,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:new Date(now).toISOString()});
const observation=(products:ReturnType<typeof product>[],observedAt=new Date(now).toISOString())=>({toolName:"commerce_search_products",products,observedAt});
test("options preserve spelling, deduplicate and normalize only whitespace",()=>{
 const options=normalizeCommerceProductOptions({status:"AVAILABLE",items:[{name:" Size\t",values:[" S ","S","","M"],usedForVariants:true}]});assert.deepEqual(options,{status:"AVAILABLE",items:[{name:"Size",values:["S","M"],usedForVariants:true}]});
 assert.equal(normalizeCommerceProductOptions({items:[{name:"Size",values:["x".repeat(129),"bad\u0000"],usedForVariants:true}]}).status,"PARTIAL");
 assert.deepEqual(normalizeCommerceProductOptions(undefined),{status:"NOT_PROVIDED",items:[]});assert.ok(!Object.hasOwn(product("1"),"options"));
 assert.equal(normalizeCommerceProductOptions({items:Array.from({length:17},(_,i)=>({name:String(i),values:[],usedForVariants:false}))}).items.length,16);
});
test("context exact resolution, same-name ambiguity and inert references only",()=>{
 const context=merge(null,[observation([product("1"),product("2")])],identity);assert.equal(resolve(context,{title:" shirt "}).kind,"AMBIGUOUS");assert.deepEqual(resolve(context,{productId:"1"}),{kind:"MATCH",productId:"1",variantId:null});assert.equal(resolve(context,{title:"yes"}).kind,"MISSING");assert.ok(!JSON.stringify(context).includes("unitPrice"));
});
test("context expiry, native identity, future rejection and deterministic bounded eviction",()=>{
 const old=merge(null,[observation([product("1")])],identity);assert.equal(merge(old,[],{...identity,now:now+86400001}).references.length,0);
 assert.equal(merge(null,[observation([product("1")],new Date(now+1).toISOString())],identity).references.length,0);
 assert.throws(()=>merge(old,[],{...identity,shopId:"foreign"}));assert.throws(()=>merge(null,[observation([product("0")])],identity));
 const context=merge(null,[observation(Array.from({length:25},(_,i)=>product(String(i+1))))],identity);assert.equal(context.references.length,20);assert.equal(context.references[0]?.productId,"1");assert.ok(CommerceConversationProductContextSchema.safeParse(context).success);
});

test("options contradictory status never invents completeness; variant attributes remain separate",()=>{
 assert.equal(normalizeCommerceProductOptions({status:"NOT_PROVIDED",items:[{name:"Size",values:["M"],usedForVariants:true}]}).status,"PARTIAL");
 assert.equal(normalizeCommerceProductOptions({status:"invalid",items:[{name:"Size",values:["M"],usedForVariants:true}]}).status,"PARTIAL");
 assert.deepEqual(CommerceProductSelectedOptionsSchema.parse([{name:" Size\n",value:" M "},{name:"Size",value:"M"},{name:"bad\u0085",value:"x"}]),[{name:"Size",value:"M"}]);
 const p=product("1");assert.deepEqual(CommerceProductSchema.parse({...p,options:{status:"NOT_PROVIDED",items:[]},selectedOptions:[]}).selectedOptions,[]);
});
test("ignored observations preserve timestamp and identity rejects before eviction",()=>{
 const previous=merge(null,[observation([product("1")])],identity);
 assert.deepEqual(merge(previous,[{...observation([product("2")]),toolName:"untrusted_tool"}],{...identity,now:now+1000}),previous);
 assert.throws(()=>merge(null,[],{...identity,shopId:"x".repeat(40000)}));
 assert.throws(()=>merge(previous,[],{...identity,conversationId:"foreign"}));
 const selected=merge(null,[observation([{...product("1"),variantId:"2"}])],identity);assert.deepEqual(resolve(selected,{productId:"1",variantId:"2"}),{kind:"MATCH",productId:"1",variantId:"2"});
});

import {recordCommerceProductPresentation as record} from './product-context.js';
test('presentation order survives reference recency, arbitrary selected options remain labels only',()=>{
 const p={...product('20'),selectedOptions:[{name:'Height',value:'2 m'},{name:'Finish',value:'Matte'},{name:'Volume',value:'15 ml'}],stock:{status:'KNOWN' as const,quantity:7,scope:'PRODUCT' as const}};
 let c=merge(null,[observation([p,product('3')])],identity);
 c=record(c,[{productId:'20',variantId:null},{productId:'3',variantId:null}],identity);
 assert.deepEqual(c.references.map(r=>r.productId),['20','3']);
 const newer={...identity,now:now+1000};c=merge(c,[observation([product('3')],new Date(newer.now).toISOString())],newer);
 assert.deepEqual(c.references.map(r=>r.productId),['3','20']);assert.deepEqual(c.presentation?.references.map(r=>r.productId),['20','3']);
 assert.deepEqual(c.references.find(r=>r.productId==='20')?.selectedOptions,p.selectedOptions);assert.ok(!JSON.stringify(c).includes('quantity'));assert.ok(!JSON.stringify(c).includes('stock'));
 assert.equal(merge(c,[],{...identity,now:now+86400001}).presentation,undefined);
 assert.throws(()=>record(c,[{productId:'999',variantId:null}],identity),/PRODUCT_PRESENTATION_INVALID/);
 assert.throws(()=>record(c,[{productId:'3',variantId:null},{productId:'3',variantId:null}],identity),/PRODUCT_PRESENTATION_INVALID/);
 assert.throws(()=>record(c,[],{...identity,shopId:'foreign'}),/IDENTITY/);
 assert.equal(CommerceConversationProductContextSchema.safeParse({...c,presentation:{references:[{productId:'999',variantId:null}],presentedAt:new Date(now).toISOString()}}).success,false);
 const evicted=merge(c,[observation(Array.from({length:20},(_,i)=>product(String(i+100))),new Date(now+2000).toISOString())],{...identity,now:now+2000});assert.equal(evicted.presentation,undefined);
});

test('recording presentation near context cap preserves bounded deterministic eviction semantics',()=>{
 const options=Array.from({length:16},(_,i)=>({name:String(i)+'n'.repeat(120),value:'v'.repeat(128)}));
 const context={schemaVersion:1 as const,shopId:identity.shopId,conversationId:identity.conversationId,platform:identity.platform,references:Array.from({length:8},(_,i)=>({productId:String(i+1),variantId:null,title:'t',observedAt:new Date(now).toISOString(),selectedOptions:structuredClone(options)})),updatedAt:new Date(now).toISOString()};
 const bytes=()=>new TextEncoder().encode(JSON.stringify(context)).length;
 while(bytes()>32760)context.references.at(-1)!.selectedOptions.pop();
 context.references.at(-1)!.title+='t'.repeat(32760-bytes());assert.equal(bytes(),32760);assert.ok(CommerceConversationProductContextSchema.safeParse(context).success);
 const selected=context.references.slice(0,3).map(({productId,variantId})=>({productId,variantId}));
 const recorded=record(context,selected,identity);assert.ok(new TextEncoder().encode(JSON.stringify(recorded)).length<=32768);assert.deepEqual(recorded.presentation?.references,selected);assert.ok(recorded.references.length<context.references.length);
 const tail=context.references.slice(-3).map(({productId,variantId})=>({productId,variantId}));const tailRecorded=record(context,tail,identity);assert.ok(new TextEncoder().encode(JSON.stringify(tailRecorded)).length<=32768);assert.equal(tailRecorded.presentation,undefined);
});
