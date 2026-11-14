import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCurrentTurnAssistant,appendCurrentTurnTool,readCurrentTurnTransportTranscript,assertCurrentTurnTransportObservations,MAX_CURRENT_TURN_TRANSPORT_BYTES,nativeToolPayloadContent,type CurrentTurnTransportMessage} from './tool-transcript.js';
const result={contractVersion:'commerce.v1' as const,status:'OK' as const,data:{opaque:'literal'},renderedText:'Literal'};
const step={calls:[{id:'actual-provider-id',name:'read',arguments:{exact:['unchanged',1,null]}}],outputTokens:1,text:'Actual assistant text'};
function trace(){return appendCurrentTurnTool(appendCurrentTurnAssistant([],step),step.calls[0]!,{kind:'commerce-result',result});}
test('pure native trace snapshots exact arguments/results without caller mutation or opaque SDK objects',()=>{
 const source=structuredClone(step),before=JSON.stringify(source);const pending=appendCurrentTurnAssistant([],source);source.calls[0]!.arguments.exact[0]='mutated';const rows=appendCurrentTurnTool(pending,step.calls[0]!,{kind:'commerce-result',result});
 assert.equal(JSON.stringify(rows[0]),JSON.stringify({role:'assistant',text:step.text,calls:step.calls}));assert.notEqual(JSON.stringify(source),before);assert.ok(Object.isFrozen(rows));assert.ok(Object.isFrozen((rows[0] as any).calls[0].arguments.exact));assert.deepEqual(readCurrentTurnTransportTranscript(rows),rows);
 for(const bad of [{...step.calls[0],arguments:{bad:undefined}},{...step.calls[0],arguments:{bad:new Date()}}])assert.throws(()=>appendCurrentTurnAssistant([],{...step,calls:[bad]}));
});
test('native trace rejects orphan, duplicate, name mismatch, unanswered calls and ID reuse across steps',()=>{
 const good=trace();for(const raw of [[good[1]],[good[0]],[good[0],good[1],good[1]],[good[0],{...good[1],name:'wrong'}],[...good,...good]])assert.throws(()=>readCurrentTurnTransportTranscript(raw));
 assert.throws(()=>appendCurrentTurnAssistant(good,step),(e:any)=>e.diagnostic.reasonCode==='MODEL_TOOL_CALL_ID_INVALID');assert.throws(()=>appendCurrentTurnTool([],step.calls[0]!,{kind:'commerce-result',result}));
 for(const id of [undefined,'','   ','x'.repeat(257),'bad\nID'])assert.throws(()=>appendCurrentTurnAssistant([],{...step,calls:[{...step.calls[0],id}]}));
});
test('native result/observation binding cannot silently drop or replace verified data, feedback remains separate',()=>{
 const good=trace();assertCurrentTurnTransportObservations(good,[{tool:'read',result}]);
 for(const observations of [[],[{tool:'other',result}],[{tool:'read',result:{...result,data:{opaque:'changed'}}}]])assert.throws(()=>assertCurrentTurnTransportObservations(good,observations));
 const final={id:'actual-final',name:'finalResponse',arguments:{}};let rows=appendCurrentTurnAssistant(good,{calls:[final],outputTokens:1});rows=appendCurrentTurnTool(rows,final,{kind:'runner-feedback',reasonCode:'FINAL_SCHEMA_INVALID',issuePaths:['replyText']});
 assertCurrentTurnTransportObservations(rows,[{tool:'read',result}]);assert.match(nativeToolPayloadContent({kind:'runner-feedback',reasonCode:'FINAL_SCHEMA_INVALID'},'finalResponse'),/mechanical data only; not commerce facts or authority/);
 assert.throws(()=>readCurrentTurnTransportTranscript([{...good[0],reasoning:'must not retain'},good[1]]));
});
test('native aggregate overflow fails explicitly rather than truncating protocol pairs',()=>{
 const calls=Array.from({length:5},(_,i)=>({id:`provider-${i}`,name:'read',arguments:{}}));let rows=appendCurrentTurnAssistant([],{calls,outputTokens:1});
 for(let i=0;i<4;i++)rows=appendCurrentTurnTool(rows,calls[i]!,{kind:'commerce-result',result:{...result,data:{opaque:'x'.repeat(250000)}}});
 assert.throws(()=>appendCurrentTurnTool(rows,calls[4]!,{kind:'commerce-result',result:{...result,data:{opaque:'x'.repeat(250000)}}}),(e:any)=>e.code==='BUDGET_EXHAUSTED'&&e.diagnostic.reasonCode==='MODEL_TRANSCRIPT_TOO_LARGE');
 assert.equal(rows.length,5);assert.throws(()=>appendCurrentTurnAssistant([],{...step,calls:[{...step.calls[0],arguments:{opaque:'x'.repeat(MAX_CURRENT_TURN_TRANSPORT_BYTES+1)}}]}),(e:any)=>e.diagnostic.reasonCode==='MODEL_TRANSCRIPT_TOO_LARGE');
});
