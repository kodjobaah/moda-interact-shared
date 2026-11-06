import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CommercePurposeProfileSchema } from './definitions';
import { CommerceManifestSchema } from './schemas';
import { exampleManifest, exampleGrant, exampleTurn, exampleTool } from './fixtures';
import { manifestMatchesGrant, deduplicateTools } from './selection';
import { prepareCommerceTurn } from './runner/preflight';
import { resolveAvailableTools } from './runner/tool-policy';
import { runCommerceTurn } from './runner/index';
import { createCommerceTurnRuntime } from './runner/runtime';
import type { RunCommerceTurnInput } from './runner/types';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
 const manifest = exampleManifest(digest, true);
 manifest.capabilities = Array.from({length: 5}, (_, position) => ({capabilityId:`cap-${position}`,key:`key-${position}`,featureId:'owner',position,toolDescriptor:{...structuredClone(exampleTool),toolId:`tool-${position}`,toolRevisionId:`rev-${position}`,name:`read_${position}`}}));
 manifest.featureBehaviours=[{featureId:'owner',behaviourPrompt:'ordinary conversation'}];
 manifest.selectedCapabilityKeys=manifest.capabilities.map(c=>c.key);
 manifest.grantedTools=deduplicateTools(manifest.capabilities);
 manifest.purposeProfile={purpose:'INITIAL_RECOVERY_OUTREACH',featureId:'outreach',releaseId:manifest.releaseId,behaviourPrompt:'trusted outreach behavior',capabilities:manifest.capabilities.map(c=>({capabilityId:c.capabilityId,toolId:c.toolDescriptor.toolId,revisionId:c.toolDescriptor.toolRevisionId,name:c.toolDescriptor.name,position:c.position,inputSchema:c.toolDescriptor.inputSchema,outputSchema:{type:'object',properties:{},additionalProperties:false}}))};
 const grant={...exampleGrant(manifest),purposeProfile:structuredClone(manifest.purposeProfile)};
 const input:RunCommerceTurnInput={executionPurpose:'INITIAL_RECOVERY_OUTREACH',turn:exampleTurn,manifest,grant,hostInstructions:['host invariant'],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,dependencies:{digest,now:()=>Date.parse('2026-09-20T00:00:10Z'),model:{invoke:async()=>({calls:[],outputTokens:0})},tools:manifest.capabilities.map(c=>({descriptor:c.toolDescriptor,isAuthorized:async()=>true,execute:async()=>({contractVersion:'commerce.v1',status:'OK',data:{},renderedText:'fixture'})}))}};
 return {manifest,grant,input};
}
test('ordered bounded profile is immutable; invalid schemas, duplicate members and byte overflow fail',()=>{
 const {manifest}=fixture(); const profile=manifest.purposeProfile!;
 const parsed=CommercePurposeProfileSchema.parse(profile);
 assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.capabilities));
 for (const bad of [{...profile,purpose:'CONVERSATION'},{...profile,capabilities:Array.from({length:33},(_,position)=>({...profile.capabilities[0],name:`member_${position}`,capabilityId:`id_${position}`,position}))},{...profile,capabilities:[profile.capabilities[1],profile.capabilities[0]]},{...profile,capabilities:[]},{...profile,capabilities:[profile.capabilities[0],profile.capabilities[0]]},{...profile,behaviourPrompt:'💚'.repeat(8193)},{...profile,capabilities:profile.capabilities.map(c=>({...c,inputSchema:{type:'object',additionalProperties:true}}))}]) assert.equal(CommercePurposeProfileSchema.safeParse(bad).success,false);
});
test('manifest and grant bind same-release exact ordered identities, behavior and schemas',()=>{
 const {manifest,grant}=fixture();assert.ok(CommerceManifestSchema.safeParse(manifest).success);assert.ok(manifestMatchesGrant(manifest,grant));
 for(const profile of [{...manifest.purposeProfile!,releaseId:'other'},{...manifest.purposeProfile!,capabilities:manifest.purposeProfile!.capabilities.map(c=>({...c,revisionId:'forged'}))}]) assert.equal(CommerceManifestSchema.safeParse({...manifest,purposeProfile:profile}).success,false);
 assert.equal(manifestMatchesGrant(manifest,{...grant,purposeProfile:{...grant.purposeProfile!,behaviourPrompt:'changed'}}),false);
});
test('trusted outreach admits fifth supported read tool; missing profile fails closed and legacy conversations remain compatible',async()=>{
 const {input}=fixture();input.grant.grantedTools.reverse(); const prepared=prepareCommerceTurn(input); const runtime=createCommerceTurnRuntime({callerSignal:input.signal,now:input.dependencies.now,deadlineMs:45000});
 assert.deepEqual((await resolveAvailableTools(prepared,runtime)).map(tool=>tool.name),["read_0","read_1","read_2","read_3","read_4"]);runtime.dispose();
 const reduced=fixture();reduced.input.manifest.purposeProfile!.capabilities.pop();reduced.input.grant.purposeProfile=structuredClone(reduced.input.manifest.purposeProfile!);
 const subset=prepareCommerceTurn(reduced.input);const rt=createCommerceTurnRuntime({callerSignal:input.signal,now:input.dependencies.now,deadlineMs:45000});assert.equal((await resolveAvailableTools(subset,rt)).length,4);rt.dispose();
 assert.ok(prepared.instructions.includes('trusted outreach behavior'));
 const missing=structuredClone(input.manifest);delete missing.purposeProfile;
 assert.throws(()=>prepareCommerceTurn({...input,manifest:missing}));
 const {executionPurpose,...conversation}=input;
 const generic=prepareCommerceTurn(conversation);assert.ok(!generic.instructions.includes('trusted outreach behavior'));
 const legacy=exampleManifest(digest);assert.ok(CommerceManifestSchema.safeParse(legacy).success);
});

test('profile output schemas fail closed before malformed data reaches model history',async()=>{
 const {input}=fixture();
 input.manifest.purposeProfile!.capabilities[0].outputSchema={type:'object',properties:{label:{type:'string',maxLength:32}},required:['label'],additionalProperties:false};
 input.grant.purposeProfile=structuredClone(input.manifest.purposeProfile!);
 input.dependencies.model.invoke=async()=>({calls:[{name:'read_0',arguments:{handle:'fixture'}}],outputTokens:1});
 const result=await runCommerceTurn(input);
 assert.equal(result.ok,false);
 if(!result.ok) assert.equal(result.error.code,'INVALID_INPUT');
});
