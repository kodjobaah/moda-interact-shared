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
