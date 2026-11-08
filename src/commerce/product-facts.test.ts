import test from "node:test";
import assert from "node:assert/strict";
import { CommerceProductSchema } from "./schemas.js";
import { CommerceProductDescriptionSchema, CommerceProductAttributesSchema, normalizeCommerceProductDescription as description, normalizeCommerceProductAttributes as attributes } from "./product-facts.js";
const base={productId:"1",variantId:null,title:"Merchant item",url:null,available:null,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:new Date(0).toISOString()};
test("description handles HTML entities and boundaries without attributes, executable subtrees or inferred claims",()=>{
 const result=description('<div>Tree &amp; pot<br>Height 2 m</div><script>unsafe()</script><style>bad</style><template>hidden</template><noscript>hidden</noscript><p><a href="https://secret.example">Care &lt;notes&gt;</a></p><!--gone-->','HTML');
 assert.equal(result.status,"AVAILABLE");assert.equal(result.text,"Tree & pot\nHeight 2 m\n\nCare <notes>");assert.ok(!/unsafe|hidden|secret|gone/.test(result.text));
 assert.equal(description('<p>literal</p>',"PLAIN_TEXT").text,'<p>literal</p>');
});
test("description codepoint, UTF8, control and malformed bounds are truthful",()=>{
 assert.deepEqual(description(undefined,"PLAIN_TEXT"),{status:"NOT_PROVIDED",text:""});assert.deepEqual(description(" \t\r\n ","PLAIN_TEXT"),{status:"NOT_PROVIDED",text:""});
 assert.deepEqual(description("a\u0000b\t c\r\n\n\n d","PLAIN_TEXT"),{status:"PARTIAL",text:"ab c\n\n d"});
 const clipped=description("😀".repeat(4097),"PLAIN_TEXT");assert.equal(clipped.status,"PARTIAL");assert.equal(Array.from(clipped.text).length,4096);assert.ok(!clipped.text.endsWith("\ud83d"));
 assert.deepEqual(description("a".repeat(65537),"HTML"),{status:"PARTIAL",text:""});assert.equal(description(42,"HTML").status,"PARTIAL");
 assert.equal(CommerceProductDescriptionSchema.safeParse({status:"AVAILABLE",text:""}).success,false);assert.equal(CommerceProductDescriptionSchema.safeParse({status:"NOT_PROVIDED",text:"supplied"}).success,false);
});
test("attributes merge native open labels, preserve units and bound by omission",()=>{
 assert.deepEqual(attributes([{name:" Shade\t",values:["Classic white","Classic white"]},{name:"Shade",values:["Ivory"]},{name:"Volume",values:["15 ml"]}]),{status:"AVAILABLE",items:[{name:"Shade",values:["Classic white","Ivory"]},{name:"Volume",values:["15 ml"]}]});
 assert.deepEqual(attributes([]),{status:"NOT_PROVIDED",items:[]});assert.equal(attributes({status:"NOT_PROVIDED",items:[{name:"Species",values:["Acer"]}]}).status,"PARTIAL");
 const bounded=attributes([{name:"Custom",values:["",42,"x".repeat(129),"control\u0000",...Array.from({length:66},(_,i)=>String(i))]},...Array.from({length:17},(_,i)=>({name:`Native ${i}`,values:["2 m"]}))]);assert.equal(bounded.status,"PARTIAL");assert.equal(bounded.items.length,16);assert.equal(bounded.items[0]?.values.length,64);
 assert.equal(CommerceProductAttributesSchema.safeParse({status:"AVAILABLE",items:[]}).success,false);
 assert.equal(CommerceProductAttributesSchema.safeParse({status:"AVAILABLE",items:[{name:"A",values:["x","x"]}]}).success,false);
});
test("legacy optional fields remain absent while new malformed fields normalize without changing original facts",()=>{
 const legacy=CommerceProductSchema.parse(base);assert.ok(!Object.hasOwn(legacy,"description"));assert.ok(!Object.hasOwn(legacy,"attributes"));
 const source={...base,description:{status:"AVAILABLE",text:"bad\u0000 fact"},attributes:{status:"AVAILABLE",items:[{name:"Size",values:["M","M",42]}]}};
 const parsed=CommerceProductSchema.parse(source);assert.equal(parsed.description?.status,"PARTIAL");assert.equal(parsed.description?.text,"bad fact");assert.deepEqual(parsed.attributes,{status:"PARTIAL",items:[{name:"Size",values:["M"]}]});assert.equal(source.description.text,"bad\u0000 fact");
 assert.equal(CommerceProductSchema.safeParse({...source,title:42}).success,false);
});
