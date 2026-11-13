import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RecoveryTemplateFrozenBindingsSchema,RecoveryTemplateSemanticKeySchema,RecoveryTemplateUrlButtonBindingSchema} from './recovery-template-bindings.js';
import {readPreparedWrapper,renderPreparedWrapper,stableJson,type PreparedWrapper,type VerifiedWrapperContext} from './commerce/presentation/index.js';
import {SemanticKeySchema,InitialOutreachRenderInputSchema} from './commerce/outreach/template-contracts.js';
import {renderInitialOutreachPreview} from './commerce/outreach/render.js';
import {evaluateInitialOutreach} from './commerce/outreach/evaluate.js';
import {fixture,ports,renderFixture,stable} from './commerce/outreach/test-fixtures.js';
import {providerObservationHash} from './commerce/outreach/provider-observation.js';
import {isShopWebsiteUrl} from './shop-website-url.js';
import {PreparedVariableResolver} from './commerce/outreach/variables.js';
import {selectSendableOutreachOffer} from './commerce/outreach/sendable-offer.js';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const website='https://shop.example';
const unsafe=[undefined,null,'','http://shop.example','https://u:p@shop.example','https://shop.example:443','https://shop.example:8443','https://shop.example/products','https://shop.example//','https://shop.example?key=x','https://shop.example#x','https://shop.example?','https://shop.example#','https://shop.example\n',' https://shop.example','https://shop.example/path\nsecond','HTTPS://shop.example','https://SHOP.example'];
const base:PreparedWrapper={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[]};
const context:VerifiedWrapperContext={conversationId:'conversation',shopId:'shop',conversationLanguageTag:'en',merchantLanguageTag:'en',variables:{'shop.name':'Saved shop','shop.websiteUrl':website},checkoutAvailable:true};
async function outreach(){const evaluated=await evaluateInitialOutreach(fixture(),ports().value);if(evaluated.kind!=='ready')throw Error('fixture');return renderFixture(evaluated);}
function withWebsiteBinding(input:Awaited<ReturnType<typeof outreach>>){
 const r=input.preparedProjection!.variant.metaRegistration!;
 r.componentsSnapshot[0]={type:'BODY',text:'{{1}}\n{{2}}\nYour basket: {{3}}'};
 r.parameterBindingsSnapshot.body=[{position:1,variable:'shop.name'},{position:2,variable:'shop.websiteUrl'},{position:3,variable:'checkout.itemsSummary'}];
 const hash=sha(stable({schemaVersion:1,family:'META_RECOVERY',category:'MARKETING',components:r.componentsSnapshot,parameterBindings:r.parameterBindingsSnapshot}));
 r.submittedContentHash=hash;r.lastObservedContentHash=providerObservationHash(r.componentsSnapshot)!;r.locale.contentHash=hash;
 return input;
}
test('website is an additive canonical text semantic on both template surfaces, never a new button authority',()=>{
 for(const schema of [RecoveryTemplateSemanticKeySchema,SemanticKeySchema]){
  assert.equal(schema.parse('shop.websiteUrl'),'shop.websiteUrl');
  for(const invalid of ['shop.website','shop.url','shop.WebsiteUrl','websiteUrl','shop.websiteUrl\n'])assert.equal(schema.safeParse(invalid).success,false);
 }
 assert.deepEqual(RecoveryTemplateFrozenBindingsSchema.parse({header:[{position:1,variable:'shop.websiteUrl'}],body:[{position:2,variable:'shop.name'}],buttons:[]}),{header:[{position:1,variable:'shop.websiteUrl'}],body:[{position:2,variable:'shop.name'}],buttons:[]});
 assert.equal(RecoveryTemplateUrlButtonBindingSchema.safeParse({index:0,subType:'url',variable:'shop.websiteUrl'}).success,false);
});
test('website token is accepted wherever shop.name is valid; checkout conditional restrictions and unknown-key refusal remain',()=>{
 for(const section of ['header','body','footer','conditional'] as const){
  const prepared:{header:unknown[];body:unknown[];footer:unknown[];conditionals:unknown[]}={...base,header:[...base.header],body:[...base.body],footer:[...base.footer],conditionals:[...base.conditionals]};
  const token={kind:'variable',name:'shop.websiteUrl'};
  if(section==='conditional')prepared.conditionals=[{when:'checkout.available',tokens:[token]}];
  else if(section==='body')prepared.body=[token,{kind:'responseSlot',name:'response.body'}];
  else prepared[section]=[token];
  assert.equal(readPreparedWrapper({schemaVersion:1,prepared},sha(stableJson(prepared)),sha).kind,'ok',section);
 }
 for(const token of [{kind:'variable',name:'shop.website'},{kind:'variable',name:'shop.websiteUrl',url:website},{kind:'variable',name:'checkout.url'}]){
  const prepared={...base,header:[token]};assert.equal(readPreparedWrapper({schemaVersion:1,prepared},sha(stableJson(prepared)),sha).kind,'invalid');
 }
});
test('existing renderer uses separate host supplied name and website values with exact immutable projection hashes',()=>{
 const prepared:PreparedWrapper={...base,header:[{kind:'variable',name:'shop.name'},{kind:'text',value:'\n'},{kind:'variable',name:'shop.websiteUrl'}]};
 const before=stableJson(prepared);const digest=sha(before);
 const read=readPreparedWrapper({schemaVersion:1,prepared},digest,sha);assert.equal(read.kind,'ok');if(read.kind!=='ok')return;
 assert.deepEqual(renderPreparedWrapper({prepared:read.prepared,context,responseBody:'Authored answer'}),{kind:'rendered',body:'Saved shop\nhttps://shop.example\nAuthored answer'});
 assert.equal(stableJson(prepared),before);
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared:{...prepared,header:[...prepared.header,{kind:'text',value:'changed'}]}},digest,sha).kind,'invalid');
});
test('website values are bounded canonical HTTPS origins; invalid or missing values do not fall back to checkout URLs',()=>{
 const prepared:PreparedWrapper={...base,header:[{kind:'variable',name:'shop.websiteUrl'}]};
 for(const value of unsafe){
  assert.equal(isShopWebsiteUrl(value),false,String(value));
  const variables={...context.variables,...(typeof value==='string'?{'shop.websiteUrl':value}:{'shop.websiteUrl':undefined}),'checkout.url':'https://shop.example/recover'};
  assert.deepEqual(renderPreparedWrapper({prepared,context:{...context,variables},responseBody:'Answer'}),{kind:'rejected',reason:'VARIABLE_UNAVAILABLE'},String(value));
 }
 for(const value of [website,website+'/']){
  assert.equal(isShopWebsiteUrl(value),true);
  assert.deepEqual(renderPreparedWrapper({prepared,context:{...context,variables:{'shop.websiteUrl':value}},responseBody:'Answer'}),{kind:'rendered',body:value+'\nAnswer'});
 }
});
test('old prepared projections and outbound inputs are unchanged and do not gain optional website data',async()=>{
 const legacy={...base,header:[{kind:'variable' as const,name:'shop.name' as const}]};const digest=sha(stableJson(legacy));
 const read=readPreparedWrapper({schemaVersion:1,prepared:legacy},digest,sha);assert.equal(read.kind,'ok');if(read.kind==='ok')assert.deepEqual(read.prepared,legacy);
 assert.deepEqual(renderPreparedWrapper({prepared:legacy,context:{...context,variables:{'shop.name':'Legacy shop'}},responseBody:'Legacy answer'}),{kind:'rendered',body:'Legacy shop\nLegacy answer'});
 const input=await outreach();const before=JSON.stringify(input);const parsed=InitialOutreachRenderInputSchema.parse(input);
 assert.equal(Object.hasOwn(parsed.variables,'shopWebsiteUrl'),false);assert.equal(JSON.stringify(input),before);
 const result=renderInitialOutreachPreview(input);assert.equal(result.kind,'ready');if(result.kind==='ready')assert.equal(result.renderedText,'Hello Test customer from Merchant: 2 × Custom label');
});
test('approved template resolves website as its own single-line parameter, preserving shop.name and basket/body bindings',async()=>{
 const input=withWebsiteBinding(await outreach());input.variables.shopWebsiteUrl=website;
 const before=JSON.stringify(input.preparedProjection);const result=renderInitialOutreachPreview(input);
 assert.equal(result.kind,'ready');if(result.kind!=='ready')return;
 assert.deepEqual(result.parameters[0],{type:'body',parameters:[{type:'text',text:'Merchant'},{type:'text',text:website},{type:'text',text:'2 × Custom label'}]});
 assert.equal(result.renderedText,'Merchant\nhttps://shop.example\nYour basket: 2 × Custom label');
 assert.equal(input.variables.shopName,'Merchant');assert.equal(JSON.stringify(input.preparedProjection),before);
});
test('selected website binding fails normally if absent/null; unsafe optional website carrier is rejected before rendering',async()=>{
 const input=withWebsiteBinding(await outreach());
 assert.deepEqual(renderInitialOutreachPreview(input),{kind:'refused',reasonCode:'BINDING_VALUE_UNAVAILABLE'});
 input.variables.shopWebsiteUrl=null;assert.deepEqual(renderInitialOutreachPreview(input),{kind:'refused',reasonCode:'BINDING_VALUE_UNAVAILABLE'});
 for(const value of unsafe.filter((v):v is string=>typeof v==='string')){
  input.variables.shopWebsiteUrl=value;assert.equal(InitialOutreachRenderInputSchema.safeParse(input).success,false,value);
  assert.deepEqual(renderInitialOutreachPreview(input),{kind:'refused',reasonCode:'INVALID_REQUEST'},value);
 }
});

test('website resolver itself rejects invalid or missing host data without normalization or URL inference',async()=>{
 const input=await outreach();const sendable=selectSendableOutreachOffer(input.evaluation.offerDecision);
 const resolver=new PreparedVariableResolver(input,'en',sendable);
 for(const value of unsafe){
  input.variables.shopWebsiteUrl=value;
  assert.throws(()=>resolver.resolve('shop.websiteUrl'),{reason:'BINDING_VALUE_UNAVAILABLE'},String(value));
 }
 input.variables.shopWebsiteUrl=website+'/';assert.equal(resolver.resolve('shop.websiteUrl'),website+'/');
 assert.equal(resolver.resolve('shop.name'),'Merchant');
});
