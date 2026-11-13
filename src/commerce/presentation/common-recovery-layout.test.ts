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
test('common projection requires exact body slot, separate media, one name/site header and checkout URL last',()=>{
 const invalids:unknown[]=[
  {...prepared,family:'META_RECOVERY'},
  {...prepared,body:[{kind:'text',value:'extra'},...prepared.body]},
  {...prepared,productImage:{variable:'response.productImage',placement:'BEFORE_BODY',optional:true}},
  {...prepared,header:prepared.header.filter(t=>t.kind!=='variable'||t.name!=='shop.name')},
  {...prepared,header:prepared.header.filter(t=>t.kind!=='variable'||t.name!=='shop.websiteUrl')},
  {...prepared,header:[...prepared.header,{kind:'variable',name:'shop.name'}]},
  {...prepared,header:[...prepared.header,{kind:'variable',name:'shop.websiteUrl'}]},
  {...prepared,footer:[{kind:'text',value:'after checkout'}]},
  {...prepared,conditionals:[]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'No URL'}]}]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'text',value:'Checkout: '},{kind:'variable',name:'checkout.url'}]}]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'},{kind:'text',value:'after URL'}]}]},
  {...prepared,conditionals:[{when:'checkout.available',tokens:[{kind:'variable',name:'checkout.url'},{kind:'variable',name:'checkout.url'}]}]},
 ];
 for(const value of invalids)assert.deepEqual(readCommonRecoveryLayoutReference(ref(value),sha),{kind:'invalid'},JSON.stringify(value));
});
test('ordinary old wrapper projections remain valid without being silently upgraded to a common reference',()=>{
 const legacy={...prepared,header:[{kind:'text' as const,value:'Legacy header'}],conditionals:[]};
 assert.equal(readPreparedWrapper({schemaVersion:1,prepared:legacy},sha(stableJson(legacy)),sha).kind,'ok');
 assert.deepEqual(readCommonRecoveryLayoutReference(ref(legacy),sha),{kind:'invalid'});
 assert.equal(readCommonRecoveryLayoutReference({...ref(),sourceHash:'b'.repeat(64),definitionId:'other-definition'},sha).kind,'ok'); // Host re-read, not the parser, establishes selected-source authority.
});

test('common checkout final line remains consumable by the ordered footer contract without a duplicate formatter',()=>{
 for(const tokens of [[{kind:'variable',name:'checkout.url'}],[{kind:'text',value:''},{kind:'variable',name:'checkout.url'}],[{kind:'text',value:'Checkout:'},{kind:'text',value:'\n'},{kind:'variable',name:'checkout.url'}]]){
  const p={...prepared,conditionals:[{when:'checkout.available',tokens}]};assert.equal(readCommonRecoveryLayoutReference(ref(p),sha).kind,'ok');
 }
});
