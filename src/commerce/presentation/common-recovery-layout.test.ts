import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MODA_SUPPORTED_LANGUAGE_TAGS} from '../../internationalization.js';
import {readCommonRecoveryLayoutReference,readPreparedWrapper,renderPreparedWrapper,stableJson,type PreparedWrapper} from './index.js';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const prepared:PreparedWrapper={schemaVersion:1,family:'MODA_CONVERSATION_WRAPPER',responseSlot:'response.body',header:[{kind:'variable',name:'shop.name'},{kind:'text',value:'\n'},{kind:'variable',name:'shop.websiteUrl'},{kind:'text',value:'\n──────────'}],body:[{kind:'responseSlot',name:'response.body'}],footer:[],conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'──────────\n'},{kind:'variable',name:'checkout.url'}]}]};
const ref=(p:unknown=prepared)=>({schemaVersion:1,definitionId:'definition-1',sourceHash:'a'.repeat(64),localeId:'locale-1',languageTag:'en',contentHash:sha(stableJson(p)),prepared:p});
test('common reference parses existing immutable projection and renders through the existing renderer without a second frame',()=>{
 const input=ref();const before=stableJson(input);const result=readCommonRecoveryLayoutReference(input,sha);assert.equal(result.kind,'ok');if(result.kind!=='ok')return;
 assert.deepEqual(result.reference,input);assert.equal(stableJson(input),before);
 const render=renderPreparedWrapper({prepared:result.reference.prepared,context:{conversationId:'c',shopId:'s',conversationLanguageTag:'en',merchantLanguageTag:'en',variables:{'shop.name':'Saved shop','shop.websiteUrl':'https://shop.example','checkout.url':'https://shop.example/recover?key=synthetic'},checkoutAvailable:true},responseBody:'Original family body\nReply STOP to opt out.'});
 assert.deepEqual(render,{kind:'rendered',body:'Saved shop\nhttps://shop.example\n──────────\nOriginal family body\nReply STOP to opt out.\n──────────\nhttps://shop.example/recover?key=synthetic'});
});
test('reference envelope is exact, bounded, canonical and hash checked',()=>{
 for(const change of [{schemaVersion:2},{definitionId:''},{definitionId:'x'.repeat(192)},{definitionId:'bad id'},{localeId:'\u0000'},{sourceHash:'A'.repeat(64)},{sourceHash:'a'.repeat(63)},{contentHash:'0'.repeat(64)},{languageTag:'EN'},{languageTag:'pt-br'},{languageTag:'en-US'},{languageTag:'xx'},{extra:true}])
  assert.deepEqual(readCommonRecoveryLayoutReference({...ref(),...change},sha),{kind:'invalid'},JSON.stringify(change));
 for(const key of Object.keys(ref())){const invalid:Record<string,unknown>={...ref()};delete invalid[key];assert.deepEqual(readCommonRecoveryLayoutReference(invalid,sha),{kind:'invalid'},key);}
 for(const languageTag of MODA_SUPPORTED_LANGUAGE_TAGS)assert.equal(readCommonRecoveryLayoutReference({...ref(),languageTag},sha).kind,'ok');
 assert.deepEqual(readCommonRecoveryLayoutReference({...ref(),prepared:{...prepared,header:[{kind:'text',value:'Tampered'}]}},sha),{kind:'invalid'});
 assert.deepEqual(readCommonRecoveryLayoutReference(ref(),()=>{throw Error('digest unavailable')}),{kind:'invalid'});
});
test('common projection keeps only the separate-media frame and exact single response slot',()=>{
 const invalids:unknown[]=[
  {...prepared,family:'META_RECOVERY'},
  {...prepared,body:[]},
  {...prepared,body:[{kind:'text',value:'extra'},...prepared.body]},
  {...prepared,body:[...prepared.body,...prepared.body]},
  {...prepared,header:[{kind:'responseSlot',name:'response.body'}]},
  {...prepared,footer:[{kind:'responseSlot',name:'response.body'}]},
  {...prepared,productImage:{variable:'response.productImage',placement:'BEFORE_BODY',optional:true}},
  {...prepared,header:[{kind:'variable',name:'unsupported.variable'}]},
  {...prepared,header:[{kind:'text',value:'{{shop.name}}'}]},
  {...prepared,header:Array.from({length:81},()=>({kind:'text',value:''}))},
  {...prepared,header:[{kind:'text',value:'x'.repeat(1501)}]},
  {...prepared,conditionals:[...prepared.conditionals,...prepared.conditionals]},
  {...prepared,conditionals:[{when:'unsupported.condition',tokens:[]}]},
 ];
 for(const value of invalids)assert.deepEqual(readCommonRecoveryLayoutReference(ref(value),sha),{kind:'invalid'},JSON.stringify(value));
});
test('alternative name/website/footer/checkout formatting is snapshot data, never Shared placement policy',()=>{
 const alternatives:PreparedWrapper[]=[
  {...prepared,header:[]},
  {...prepared,header:[{kind:'text',value:'Authored header'}],footer:[{kind:'variable',name:'shop.name'},{kind:'variable',name:'shop.websiteUrl'}],conditionals:[]},
  {...prepared,header:[{kind:'variable',name:'shop.name'},{kind:'variable',name:'shop.name'}],footer:[{kind:'text',value:'Authored footer'}]},
  {...prepared,header:[{kind:'variable',name:'shop.name'}],conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'Website: '},{kind:'variable',name:'shop.websiteUrl'},{kind:'text',value:'\nCheckout: '},{kind:'variable',name:'checkout.url'}]}]},
  {...prepared,conditionals:[]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'No URL selected'}]}]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'Checkout: '},{kind:'variable',name:'checkout.url'},{kind:'text',value:' Authored trailing text'}]}]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'},{kind:'variable',name:'checkout.url'}]}]},
 ];
 for(const p of alternatives){const input=ref(p),before=stableJson(input),read=readCommonRecoveryLayoutReference(input,sha);assert.equal(read.kind,'ok');if(read.kind==='ok')assert.deepEqual(read.reference,input);assert.equal(stableJson(input),before);}
 const p=alternatives[3]!;const read=readCommonRecoveryLayoutReference(ref(p),sha);assert.equal(read.kind,'ok');if(read.kind!=='ok')return;
 const rendered=renderPreparedWrapper({prepared:read.reference.prepared,context:{conversationId:'c',shopId:'s',conversationLanguageTag:'en',merchantLanguageTag:'en',variables:{'shop.name':'Saved shop','shop.websiteUrl':'https://shop.example','checkout.url':'https://shop.example/recover?key=synthetic'},checkoutAvailable:true},responseBody:'Complete answer'});
 assert.deepEqual(rendered,{kind:'rendered',body:'Saved shop\nComplete answer\nWebsite: https://shop.example\nCheckout: https://shop.example/recover?key=synthetic'});
});
test('a parsed snapshot does not establish selected source, audience, activation or tenant authority',()=>{
 const ordinary={...prepared,header:[{kind:'text' as const,value:'Ordinary header'}],conditionals:[]};
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared:ordinary},sha(stableJson(ordinary)),sha).kind,'ok');
 assert.equal(readCommonRecoveryLayoutReference(ref(ordinary),sha).kind,'ok');
 assert.equal(readCommonRecoveryLayoutReference({...ref(),sourceHash:'b'.repeat(64),definitionId:'other-definition'},sha).kind,'ok');
});
test('supported variable placements parse without a common-specific allowlist; generic contextual grammar stays intact',()=>{
 const names=['customer.firstName','shopBrand.brandName','shopBrand.logoUrl','shopBrand.logoAltText','shopBrand.logoWidth','shopBrand.logoHeight','shopBrand.squareLogoUrl','shopBrand.squareLogoAltText','shopBrand.coverImageUrl','shop.name','shop.websiteUrl'] as const;
 for(const name of names){
  const token={kind:'variable' as const,name};
  for(const p of [{...prepared,header:[...prepared.header,token]},{...prepared,footer:[token]},{...prepared,conditionals:[{when:'checkout.available' as const,tokens:[token,...prepared.conditionals[0]!.tokens]}]}])assert.equal(readCommonRecoveryLayoutReference(ref(p),sha).kind,'ok',name);
 }
 // This is the existing prepared-token context grammar, not a new common placement rule.
 for(const section of ['header','footer'] as const){const p={...prepared,[section]:[{kind:'variable',name:'checkout.url'}]};assert.deepEqual(readCommonRecoveryLayoutReference(ref(p),sha),{kind:'invalid'});}
});
