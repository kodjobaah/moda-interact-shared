import {canonicalJson,jsonBytes,type Digest} from '../canonical-json.js';
import type {CommerceFinalResponse} from '../response.js';
import type {CommerceTurnIdentity} from '../schemas.js';
import type {ModelStep} from './types.js';
import {assertCurrentTurnTransportBounded,isNativeToolCallId,type NativeModelCall} from './tool-transcript.js';
import {RunnerFailure} from './failure.js';
import type {CommerceTurnRuntime} from './runtime.js';
export type TerminalToolDescriptor=Readonly<{name:string;description:string;inputSchema:unknown}>;
export type TerminalDecisionBinding=Readonly<{turn:Readonly<CommerceTurnIdentity>;modelStep:number;callId:string;callIds:readonly string[];toolName:string;rawCallSha256:string;rawStepSha256:string;rawCallsSha256:string;responseContractHash:string}>;
export type TerminalDecisionInput=Readonly<{binding:TerminalDecisionBinding;transportStep:Readonly<ModelStep>;call:NativeModelCall;calls:readonly NativeModelCall[];observations:readonly Readonly<{tool:string;result:unknown}>[];requiredReferral:CommerceFinalResponse['referralReason']}>;
export type TerminalDecisionResult=Readonly<{kind:'decision';binding:TerminalDecisionBinding;value:unknown}>|Readonly<{kind:'invalid';binding:TerminalDecisionBinding}>;
export type TerminalToolSelectionInput=Readonly<{turn:Readonly<CommerceTurnIdentity>;modelStep:number;responseContractHash:string;observations:readonly Readonly<{tool:string;result:unknown}>[];requiredReferral:CommerceFinalResponse['referralReason']}>;
export type TerminalDecisionPort=Readonly<{batchMode?:'equivalent'|'atomic';responseContractHash:string;terminalTools:readonly TerminalToolDescriptor[];selectTools?(input:TerminalToolSelectionInput):readonly string[];project(input:TerminalDecisionInput):TerminalDecisionResult}>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const only=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));
function invalidPort():never{throw new RunnerFailure('INVALID_INPUT',{stage:'preflight.validate',reasonCode:'TERMINAL_PORT_INVALID'});}
function invalidDecision():never{throw new RunnerFailure('INVALID_FINAL',{stage:'final.validate',reasonCode:'TERMINAL_DECISION_INVALID'});}
export function immutableTerminalSnapshot<T>(value:T):T {
 assertCurrentTurnTransportBounded(value);const clone=structuredClone(value);
 const freeze=(v:unknown):void=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};
 freeze(clone);return clone;
}
/** Admission snapshots transport declarations; schemas are app-owned, never interpreted as business policy. */
export function prepareTerminalDecisionPort(raw:TerminalDecisionPort|undefined,pinnedHash:string,ordinaryNames:readonly string[],native:boolean):TerminalDecisionPort|undefined {
 if(raw===undefined)return undefined;
 try{
  if(!native||!object(raw)||raw.batchMode!==undefined&&!['equivalent','atomic'].includes(raw.batchMode)||!only(raw,['responseContractHash','terminalTools','project','selectTools','batchMode'])||raw.responseContractHash!==pinnedHash||typeof raw.project!=='function'||raw.project.constructor.name==='AsyncFunction'||raw.selectTools!==undefined&&(typeof raw.selectTools!=='function'||raw.selectTools.constructor.name==='AsyncFunction')||!Array.isArray(raw.terminalTools)||raw.terminalTools.length<1||raw.terminalTools.length>32)invalidPort();
  const names=new Set<string>();
  for(const tool of raw.terminalTools){if(!object(tool)||!only(tool,['name','description','inputSchema'])||typeof tool.name!=='string'||!tool.name.trim()||tool.name.length>128||names.has(tool.name)||tool.name==='finalResponse'||ordinaryNames.includes(tool.name)||typeof tool.description!=='string'||!object(tool.inputSchema))invalidPort();names.add(tool.name);}
  assertCurrentTurnTransportBounded(raw.terminalTools);if(jsonBytes(raw.terminalTools)>262144)invalidPort();
  return Object.freeze({...(raw.batchMode?{batchMode:raw.batchMode}:{}),responseContractHash:pinnedHash,terminalTools:immutableTerminalSnapshot(raw.terminalTools),...(raw.selectTools?{selectTools:raw.selectTools}:{}),project:raw.project});
 }catch{invalidPort();}
}
export function selectTerminalDecisionTools(port:TerminalDecisionPort,context:TerminalToolSelectionInput,runtime:Pick<CommerceTurnRuntime,'checkCancellationAndDeadline'>):readonly TerminalToolDescriptor[]{
 runtime.checkCancellationAndDeadline();let result:unknown,failed=false;
 try{result=port.selectTools?port.selectTools(immutableTerminalSnapshot(context)):port.terminalTools.map(t=>t.name);}catch{failed=true;}
 runtime.checkCancellationAndDeadline();
 if(result instanceof Promise){void result.catch(()=>{});failed=true;}
 if(failed||!Array.isArray(result)||result.length<1||result.length>port.terminalTools.length||new Set(result).size!==result.length||result.some(n=>typeof n!=='string'||!port.terminalTools.some(t=>t.name===n)))throw new RunnerFailure('INVALID_FINAL',{stage:'model.invoke',reasonCode:'TERMINAL_TOOL_SELECTION_INVALID'});
 return Object.freeze(result.map(name=>port.terminalTools.find(t=>t.name===name)!));
}
/** Admit every actual member before exposing the first actual call; atomic semantics belong to the app. */
export function readTerminalCalls(step:ModelStep,allowedToolNames:readonly string[],batchMode:'equivalent'|'atomic'='equivalent'):readonly NativeModelCall[]{
 const first=step.calls[0];
 if(!first||!allowedToolNames.includes(first.name))invalidDecision();
 const args=canonicalJson(first.arguments),ids=new Set<string>();
 for(const call of step.calls){
  if(!isNativeToolCallId(call.id)||ids.has(call.id)||!allowedToolNames.includes(call.name)||batchMode==='equivalent'&&(call.name!==first.name||canonicalJson(call.arguments)!==args))invalidDecision();
  ids.add(call.id);
 }
 return step.calls as readonly NativeModelCall[];
}
/** Project once, synchronously, using a framework-issued binding. No model/tool invocation occurs here. */
export function projectTerminalDecision(input:{port:TerminalDecisionPort;step:ModelStep;turn:CommerceTurnIdentity;modelStep:number;responseContractHash:string;observations:readonly Readonly<{tool:string;result:unknown}>[];requiredReferral:CommerceFinalResponse['referralReason'];allowedToolNames:readonly string[];digest:Digest;runtime:Pick<CommerceTurnRuntime,'checkCancellationAndDeadline'>}):unknown {
 input.runtime.checkCancellationAndDeadline();
 const stepBefore=canonicalJson(input.step),calls=readTerminalCalls(input.step,input.allowedToolNames,input.port.batchMode),call=calls[0]!;
 if(input.port.responseContractHash!==input.responseContractHash||!input.port.terminalTools.some(t=>t.name===call.name))invalidDecision();
 const hash=input.digest(canonicalJson(call)),rawStepSha256=input.digest(stepBefore),rawCallsSha256=input.digest(canonicalJson(calls));if(![hash,rawStepSha256,rawCallsSha256].every(h=>/^[a-f0-9]{64}$/.test(h)))invalidDecision();
 const binding=immutableTerminalSnapshot<TerminalDecisionBinding>({turn:input.turn,modelStep:input.modelStep,callId:call.id,callIds:calls.map(c=>c.id),toolName:call.name,rawCallSha256:hash,rawStepSha256,rawCallsSha256,responseContractHash:input.responseContractHash});
 const request=Object.freeze({binding,transportStep:immutableTerminalSnapshot(input.step),call:immutableTerminalSnapshot(call),calls:immutableTerminalSnapshot(calls),observations:immutableTerminalSnapshot(input.observations),requiredReferral:input.requiredReferral});
 let result:unknown,failed=false;
 try{result=input.port.project(request);}catch{failed=true;}
 input.runtime.checkCancellationAndDeadline();
 if(failed||canonicalJson(input.step)!==stepBefore)invalidDecision();
 if(result instanceof Promise){void result.catch(()=>{});invalidDecision();}
 if(!object(result)||!only(result,['kind','binding','value'])||result.binding!==binding||result.kind!=='decision'||!Object.hasOwn(result,'value'))invalidDecision();
 try{
  assertCurrentTurnTransportBounded(result.value);
  if(jsonBytes(result.value)>262144)throw new RunnerFailure('BUDGET_EXHAUSTED',{stage:'final.validate',reasonCode:'TERMINAL_DECISION_TOO_LARGE'});
  return immutableTerminalSnapshot(result.value);
 }catch(error){if(error instanceof RunnerFailure&&error.code==='BUDGET_EXHAUSTED')throw error;invalidDecision();}
}
