import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CommerceProductStockSchema, CommerceToolOutputs, CommerceManifestSchema } from "./schemas";
import { CommercePurposeProfileSchema } from "./definitions";
import { exampleManifest, exampleGrant } from "./fixtures";
import { manifestMatchesGrant } from "./selection";
import { DetailsSchemaSchema } from "./subset";
import { compileCommercePurposeOutputSchema, validateCommercePurposeOutputSchema } from "./purpose-output";

const accepted015=JSON.parse(readFileSync(new URL("./purpose-output.accepted015.fixtures.json",import.meta.url),"utf8"));
const descriptors = JSON.parse(readFileSync(new URL("./purpose-output.fixtures.json", import.meta.url), "utf8"));
const pairs = [
  ["discounts.getOptions", "commerce_get_discount_options"], ["discounts.getDetails", "commerce_get_discount_details"],
  ["products.search", "commerce_search_products"], ["products.get", "commerce_get_product"],
] as const;
const at = "2026-11-06T12:00:00Z";
const offer = {offerId:"offer-1",title:"Offer",method:"CODE",code:"CODE",startsAt:at,endsAt:"2027-01-01T00:00:00Z",support:"SUPPORTED",reasonCodes:[]};
const product = {productId:"product-1",variantId:"variant-1",title:"Product",url:"https://store.example/p",available:true,unitPrice:"12.50",currency:"USD",productType:"Tools",vendor:"Vendor",categories:["Tools"],categoryIds:Array(128).fill("category"),collectionIds:Array(128).fill("collection"),imageUrl:"https://store.example/image",saleEvidence:{regularPrice:"15",salePrice:"12.50",observedAt:at},observedAt:at};
const facts = {provider:"SHOPIFY",completeness:"COMPLETE",observedAt:at,providerStatus:"ACTIVE",unavailableAt:null,discountKind:"PERCENTAGE",discountValue:"10",discountCurrency:null,targeting:{kind:"ALL",includedProductIds:[],includedVariantIds:[],includedCategoryIds:[],includedCollectionIds:[],excludedProductIds:[],excludedVariantIds:[],excludedCategoryIds:[],excludedCollectionIds:[]},minimumSubtotal:null,maximumSubtotal:null,subtotalRequirementCurrency:null,minimumQuantity:null,usageLimit:null,usageCount:null,perCustomerLimit:null,customerScope:"ALL",excludesSaleItems:false,individualUse:false,combination:{discountClasses:["ORDER"],shopifyPlus:false,combinesWith:{orderDiscounts:true,productDiscounts:false,shippingDiscounts:false},discountTags:[],allowedSameLineProductTags:[]},unrepresentedConditions:[]};
const results: Record<string, unknown[]> = {
  "discounts.getOptions":[{outcome:"UNAVAILABLE",reasonCode:"TEMPORARY_UNAVAILABLE"},{mode:"FIXED",offers:[offer],truncated:false,cursor:null}],
  "discounts.getDetails":[{outcome:"UNAVAILABLE",reasonCode:"TEMPORARY_UNAVAILABLE"},{details:null},{details:{offer,facts,providerDiscountId:"provider-1"}}],
  "products.search":[{products:[product],cursor:null,truncated:false},{products:[],cursor:null,truncated:false}],
  "products.get":[{product:null},{product},{product:{...product,saleEvidence:null,available:null,url:null}}],
};
function object(properties: Record<string, unknown> = {}): any { return {type:"object",properties,additionalProperties:false}; }

// Match existing descriptor serialization only: no field projection or result changes.
function descriptor(raw: any): any {
  if (Array.isArray(raw)) return raw.map(descriptor);
  if (!raw || typeof raw !== "object") return raw;
  const result: any = Object.fromEntries(Object.entries(raw).filter(([key]) => !["$schema", "default"].includes(key)).map(([key, value]) => [key, descriptor(value)]));
  if (result.anyOf?.length === 2 && result.anyOf[1].type === "null" && typeof result.anyOf[0].type === "string") {
    const branch = result.anyOf[0]; delete result.anyOf;
    Object.assign(result, branch, {type: [branch.type, "null"]});
  }
  if (result.type === "string" && result.enum?.every((value:unknown) => typeof value === "string"))
    result.maxLength ??= Math.max(...result.enum.map((value:string) => value.length));
  return result;
}

test("audited descriptors exactly equal real registered outputs and validate complete unchanged results", () => {
  for (const [operation, name] of pairs) {
    const generated = z.toJSONSchema(CommerceToolOutputs[name]);
    const schema = descriptor(generated);
    // Locked Zod currently emits optional seconds; audited receipt required them.
    // Assert the exact single known spelling difference, never erase its semantics.
    const expected = JSON.parse(JSON.stringify(descriptors[operation]).replaceAll(
      JSON.stringify("^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$").slice(1,-1), JSON.stringify("^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$").slice(1,-1)));
    if(accepted015[operation]) {
      const baseline=structuredClone(accepted015[operation]);
      const product=operation==='products.get'?baseline.properties.product:baseline.properties.products.items;
      // Exact accepted015 source shape plus the sole optional stock contract.
      product.properties.stock=descriptor(z.toJSONSchema(CommerceProductStockSchema));
      assert.deepEqual(schema,baseline,operation);
    }else assert.deepEqual(schema, expected, operation);
    assert.ok(validateCommercePurposeOutputSchema(schema), operation);
    const validator = compileCommercePurposeOutputSchema(schema);
    const auditedValidator = compileCommercePurposeOutputSchema(descriptors[operation]);
    for (const value of results[operation]!) {
      assert.ok(CommerceToolOutputs[name].safeParse(value).success, `${operation} canonical result`);
      assert.equal(validator.safeParse(value).success, true, operation);
      assert.equal(auditedValidator.safeParse(value).success, true, operation);
      assert.deepEqual(validator.parse(value), value);
    }
    assert.equal(DetailsSchemaSchema.safeParse(schema).success, false, "existing Details subset unchanged");
  }
});

test("real descriptors bind canonical profile, manifest and grants including output schema identity", () => {
  const digest = (s:string) => createHash("sha256").update(s).digest("hex");
  for (const [operation] of pairs) {
    const manifest = exampleManifest(digest, true);
    const c = manifest.capabilities[0]!;
    const raw = {purpose:"INITIAL_RECOVERY_OUTREACH",featureId:"purpose",releaseId:manifest.releaseId,behaviourPrompt:"trusted",capabilities:[{capabilityId:c.capabilityId,toolId:c.toolDescriptor.toolId,revisionId:c.toolDescriptor.toolRevisionId,name:c.toolDescriptor.name,position:0,inputSchema:c.toolDescriptor.inputSchema,outputSchema:descriptors[operation]}]};
    manifest.purposeProfile = CommercePurposeProfileSchema.parse(raw);
    assert.ok(CommerceManifestSchema.safeParse(manifest).success);
    const grant = {...exampleGrant(manifest),purposeProfile:structuredClone(manifest.purposeProfile)};
    assert.ok(manifestMatchesGrant(manifest, grant));
    grant.purposeProfile.capabilities[0]!.outputSchema = object({forged:{type:"boolean"}});
    assert.equal(manifestMatchesGrant(manifest,grant),false);
  }
});

test("invalid real default data fails closed: unions, nulls, amounts, UTC dates, safe URLs and unknown fields", () => {
  const productValidator = compileCommercePurposeOutputSchema(descriptors["products.get"]);
  for (const patch of [{unitPrice:"1e3"},{url:"http://store.example/p"},{url:"https://user:secret@store.example/p"},{url:"https://store.example:444/p"},{url:"javascript:alert(1)"},{observedAt:"2026-02-29T12:00:00Z"},{observedAt:"2026-11-06T12:00:00Z\n"},{categories:Array(129).fill("x")},{collectionIds:Array(129).fill("x")},{extra:true}])
    assert.equal(productValidator.safeParse({product:{...product,...patch}}).success,false);
  const details = compileCommercePurposeOutputSchema(descriptors["discounts.getDetails"]);
  assert.equal(details.safeParse({details:{offer:{...offer,startsAt:"2026-02-30T12:00:00Z"},facts,providerDiscountId:null}}).success,false);
  assert.equal(details.safeParse({outcome:"UNAVAILABLE",reasonCode:"DENIED"}).success,false);
  assert.equal(details.safeParse({details:[]}).success,false);
});

test("purpose subset rejects hostile schemas and finite resource-limit violations", () => {
  let deep:unknown=object();for(let n=0;n<9;n++)deep=object({child:deep});
  const cyclic:any=object();cyclic.properties.self=cyclic;
  let wide:any=object();for(let n=0;n<4;n++)wide={anyOf:Array(4).fill(wide)};
  const bad = [wide,deep,cyclic,{$ref:"x"},object({x:{type:"string",pattern:"^(a+)+$"}}),object({x:{type:"string",format:"email"}}),object({x:{type:"string",maxLength:4097}}),object({x:{type:"array",items:{type:"boolean"},maxItems:129}}),object({x:{type:"number",minimum:NaN}}),object({x:{type:"integer",enum:[Infinity]}}),{...object(),additionalProperties:true},{anyOf:Array(5).fill(object())},{anyOf:[object()]},object(Object.fromEntries(Array.from({length:129},(_,n)=>[`p${n}`,{type:"boolean"}]))),{...object(),description:"x".repeat(32769)},Object.assign(Object.create({}),object()),object({constructor:{type:"string"}}),object({x:{type:["null","object"],properties:{},additionalProperties:false}})];
  for(const schema of bad) assert.equal(validateCommercePurposeOutputSchema(schema),false);
});

test("implicit bounds, union budgets and compiler snapshot prevent bypass without transforming output", () => {
  const raw=object({values:{type:"array",items:{type:"string"}}});
  const validator=compileCommercePurposeOutputSchema(raw);
  assert.ok(validator.safeParse({values:Array(128).fill("value")}).success);
  assert.equal(validator.safeParse({values:Array(129).fill("value")}).success,false);
  assert.equal(validator.safeParse({values:["x".repeat(4097)]}).success,false);
  assert.equal(validator.safeParse({values:Array(10).fill("x".repeat(4096))}).success,false);
  (raw.properties.values as any).items={type:"boolean"};
  assert.ok(validator.safeParse({values:["original"]}).success);
  assert.equal(validator.safeParse({values:[true]}).success,false);
  const cycle:any={values:[]};cycle.values.push(cycle);
  for(const value of [cycle,{values:[NaN]},Object.assign(Object.create({}),{values:[]}),{values:new Array(2)}])assert.equal(validator.safeParse(value).success,false);
  const nestedUnion={anyOf:[object({a:{anyOf:[{type:"string",maxLength:10},{type:"boolean"}]}}),object({b:{type:"integer"}})]};
  const fifth=compileCommercePurposeOutputSchema(nestedUnion);
  assert.ok(fifth.safeParse({a:true}).success);assert.ok(fifth.safeParse({a:"read"}).success);assert.ok(fifth.safeParse({b:1}).success);
  assert.equal(fifth.safeParse({a:3}).success,false);
});

test("only the current exact canonical datetime spelling permits UTC minute precision", () => {
  const old = descriptors["products.get"];
  const current = descriptor(z.toJSONSchema(CommerceToolOutputs.commerce_get_product));
  const historical = compileCommercePurposeOutputSchema(old), newer = compileCommercePurposeOutputSchema(current);
  const minute = {product:{...product,observedAt:"2026-11-06T12:00Z"}};
  assert.equal(historical.safeParse(minute).success,false);
  assert.equal(newer.safeParse(minute).success,true);
  assert.ok(CommerceToolOutputs.commerce_get_product.safeParse(minute).success);
  for(const observedAt of ["2026-02-29T12:00Z","2026-11-06T12:00+00:00","2026-11-06T12:00Z\n"])
    assert.equal(newer.safeParse({product:{...product,observedAt}}).success,false);
});

test('bounded oneOf/typed scalar const compiles real stock outputs without changing complete results',()=>{
 for(const name of ['commerce_get_product','commerce_search_products'] as const){
 const schema=descriptor(z.toJSONSchema(CommerceToolOutputs[name]));const validator=compileCommercePurposeOutputSchema(schema);
 for(const stock of [{status:'KNOWN',quantity:0,scope:'VARIANT'},{status:'KNOWN',quantity:Number.MAX_SAFE_INTEGER,scope:'PRODUCT'},{status:'NOT_TRACKED'},{status:'UNAVAILABLE'}]){
 const p={productId:'1',variantId:null,title:'Native',url:null,available:false,unitPrice:null,currency:null,productType:null,vendor:null,observedAt:'2026-11-09T00:00:00.000Z',stock};const result=name==='commerce_get_product'?{product:p}:{products:[p],cursor:null,truncated:false};assert.ok(CommerceToolOutputs[name].safeParse(result).success);assert.deepEqual(validator.parse(result),result);
 const legacy=structuredClone(result);if('product'in legacy)delete (legacy.product as any).stock;else delete (legacy.products[0] as any).stock;assert.ok(validator.safeParse(legacy).success);
 for(const bad of [{status:'KNOWN',quantity:-1,scope:'PRODUCT'},{status:'KNOWN',quantity:1.2,scope:'PRODUCT'},{status:'KNOWN',quantity:0,scope:'INVALID'},{status:'NOT_TRACKED',quantity:0},{status:'UNAVAILABLE',extra:true}]){const invalid=name==='commerce_get_product'?{product:{...p,stock:bad}}:{products:[{...p,stock:bad}],cursor:null,truncated:false};assert.equal(validator.safeParse(invalid).success,false);}
 }
 }
 const union={type:'object',properties:{value:{oneOf:[{type:'integer',minimum:0},{type:'integer',maximum:10}]}},required:['value'],additionalProperties:false};
 const exclusive=compileCommercePurposeOutputSchema(union);assert.equal(exclusive.safeParse({value:5}).success,false);assert.equal(exclusive.safeParse({value:11}).success,true);
 for(const value of [null,true,'literal',2]){const type=value===null?['string','null']:typeof value;const v=compileCommercePurposeOutputSchema({type:'object',properties:{value:{type,const:value}},required:['value'],additionalProperties:false});assert.ok(v.safeParse({value}).success);assert.equal(v.safeParse({value:'wrong'}).success,false);}
 for(const bad of [
 {type:'string',const:{}},{type:'string',const:[]},{type:'integer',const:1.2},{type:'number',const:Infinity},{type:'number',const:Number.MAX_SAFE_INTEGER+1},{type:'string',const:'x',enum:['x']},{type:'string',const:'x'.repeat(4097)},
 {oneOf:[{type:'string'},{type:'string'}],anyOf:[{type:'string'},{type:'string'}]},
 {oneOf:Array(5).fill({type:'string'})},{oneOf:[{type:'string'},{type:'string'}],unknown:true}
 ])assert.equal(validateCommercePurposeOutputSchema({type:'object',properties:{bad},additionalProperties:false}),false);
});
