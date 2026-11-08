import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import {
  CommerceTurnIdentitySchema, CommerceResolveAssertionSchema, CommerceExecuteAssertionSchema,
  CommerceAssertionSchema, CommerceConversationGrantSchema, CommerceManifestSchema,
  commerceConversationScope, type CommerceTurnIdentity,
} from "./schemas";
import { canonicalJson } from "./canonical-json";
import { exampleTurn, exampleManifest, exampleGrant, exampleTool } from "./fixtures";
import { commerceTurnMatchesGrant, deduplicateTools, manifestMatchesGrant } from "./selection";
import { prepareCommerceTurn } from "./runner/preflight";
import { resolveAvailableTools, resolveToolCall } from "./runner/tool-policy";
import { createCommerceTurnRuntime } from "./runner/runtime";
import { runCommerceTurn } from "./runner/index";
import type { RunCommerceTurnInput } from "./runner/types";

const digest = (s:string) => createHash("sha256").update(s).digest("hex");
const now = Date.parse("2026-09-20T00:00:10Z");
const standalone = (): CommerceTurnIdentity => ({contractVersion:"commerce.v1",conversationScope:"STANDALONE",shopId:"shop-fixture",conversationId:"conversation-fixture",inboundVersion:1});
function fixture(withTool=false): RunCommerceTurnInput {
  const manifest=exampleManifest(digest,withTool), grant=exampleGrant(manifest);
  return {turn:exampleTurn,manifest,grant,hostInstructions:[],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,
    dependencies:{digest,now:()=>now,model:{invoke:async()=>({calls:[],outputTokens:1,text:"Please contact the store."})},tools:withTool?[{descriptor:structuredClone(exampleTool),isAuthorized:async()=>true,execute:async()=>({contractVersion:"commerce.v1",status:"OK",data:{},renderedText:"fixture"})}]:[]}};
}
function scopeFixture(allowed?: ("RECOVERY"|"STANDALONE")[]) {
  const input=fixture(true);
  input.turn=standalone();input.grant.conversationScope="STANDALONE";
  if(allowed){input.manifest.capabilities[0]!.toolDescriptor.allowedConversationScopes=allowed;input.dependencies.tools[0]!.descriptor=input.manifest.capabilities[0]!.toolDescriptor;}
  input.manifest.grantedTools=deduplicateTools(input.manifest.capabilities);
  input.grant.grantedTools=structuredClone(input.manifest.grantedTools);
  return input;
}

test("historical recovery parsing/assertion bytes remain exact; explicit ownership has strict disjoint fields",()=>{
  assert.deepEqual(CommerceTurnIdentitySchema.parse(exampleTurn),exampleTurn);
  assert.equal(commerceConversationScope(CommerceTurnIdentitySchema.parse(exampleTurn)),"RECOVERY");
  const oldResolve={...exampleTurn,purpose:"resolve"};
  assert.deepEqual(CommerceResolveAssertionSchema.parse(oldResolve),oldResolve);
  const recovery={...exampleTurn,conversationScope:"RECOVERY"};
  assert.ok(CommerceTurnIdentitySchema.safeParse(recovery).success);
  assert.deepEqual(CommerceTurnIdentitySchema.parse(standalone()),standalone());
  for(const invalid of [
    {...standalone(),checkoutRecoveryId:"recovery-fixture"},{...standalone(),checkoutRecoveryId:null},{...standalone(),checkoutRecoveryId:undefined},
    {...standalone(),conversationScope:undefined},{...standalone(),conversationScope:"UNKNOWN"},
    {...standalone(),shopId:""},{...standalone(),conversationId:""},{...standalone(),inboundVersion:0},
    {...standalone(),actorId:"invented"},{...recovery,checkoutRecoveryId:undefined},{...recovery,checkoutRecoveryId:"standalone"},
  ])assert.equal(CommerceTurnIdentitySchema.safeParse(invalid).success,false);
});

test("resolve/execute assertions preserve full canonical ownership bytes without inventing signing or actor authority",()=>{
  const resolve={...standalone(),purpose:"resolve"},execute={...standalone(),purpose:"execute",grantId:"grant-fixture",releaseId:"release-fixture"};
  assert.deepEqual(CommerceResolveAssertionSchema.parse(resolve),resolve);
  assert.deepEqual(CommerceExecuteAssertionSchema.parse(execute),execute);
  assert.deepEqual(CommerceAssertionSchema.parse(execute),execute);
  // Demonstrate existing canonical serializer binds all fields supplied to host signing.
  const sign=(value:unknown)=>createHmac("sha256","synthetic-key").update(canonicalJson(value)).digest("hex");
  for(const patch of [{conversationScope:"RECOVERY",checkoutRecoveryId:"recovery-real"},{shopId:"other-shop"},{conversationId:"other-conversation"},{inboundVersion:2},{grantId:"other-grant"},{releaseId:"other-release"}])
    assert.notEqual(sign(execute),sign({...execute,...patch}));
  assert.equal(CommerceAssertionSchema.safeParse({...execute,checkoutRecoveryId:null}).success,false);
  assert.equal(CommerceAssertionSchema.safeParse({...execute,purpose:"resolve"}).success,false);
});

test("canonical grants bind scope, tenant, recovery ID, version floor and injected retention deadline",()=>{
  const input=fixture();assert.ok(commerceTurnMatchesGrant(input.turn,input.grant,now));
  assert.equal(commerceTurnMatchesGrant(standalone(),input.grant,now),false,"old grant recovery-only");
  const grant={...input.grant,conversationScope:"STANDALONE" as const};
  assert.ok(CommerceConversationGrantSchema.safeParse(grant).success);
  assert.ok(commerceTurnMatchesGrant(standalone(),grant,now));
  for(const invalid of [{...grant,checkoutRecoveryId:null},{...grant,checkoutRecoveryId:undefined},{...grant,checkoutRecoveryId:"real"},{...input.grant,conversationScope:undefined},{...input.grant,checkoutRecoveryId:"real"}])
    assert.equal(CommerceConversationGrantSchema.safeParse(invalid).success,false);
  for(const patch of [{shopId:"other-shop"},{conversationId:"other-conversation"},{inboundVersion:0}])
    assert.equal(commerceTurnMatchesGrant({...standalone(),...patch},grant,now),false);
  assert.equal(commerceTurnMatchesGrant(standalone(),{...grant,initialInboundVersion:2},now),false);
  const recoveryGrant={...input.grant,conversationScope:"RECOVERY" as const,checkoutRecoveryId:"real-recovery"};
  assert.equal(commerceTurnMatchesGrant({...exampleTurn,conversationScope:"RECOVERY"},recoveryGrant,now),false);
  assert.ok(commerceTurnMatchesGrant({...exampleTurn,checkoutRecoveryId:"real-recovery",conversationScope:"RECOVERY"},recoveryGrant,now));
  assert.equal(commerceTurnMatchesGrant(standalone(),{...grant,expiresAt:new Date(now).toISOString()},now),false);
  assert.ok(commerceTurnMatchesGrant(standalone(),{...grant,expiresAt:new Date(now+1).toISOString()},now));
  assert.equal(commerceTurnMatchesGrant(standalone(),grant,NaN),false);
  assert.equal(commerceTurnMatchesGrant(exampleTurn,{...input.grant,expiresAt:new Date(now).toISOString()},now),false,"historical retention gap closed without changing recovery bytes");
});

test("descriptor admission is explicit/pinned and cannot be widened by standalone identity, grant or tool text",async()=>{
  for(const allowed of [undefined,["RECOVERY"]] as const){
    const input=scopeFixture(allowed? [...allowed]:undefined);let authorized=0;input.dependencies.tools[0]!.isAuthorized=async()=>{authorized++;return true;};
    const prepared=prepareCommerceTurn(input),rt=createCommerceTurnRuntime({callerSignal:input.signal,now:input.dependencies.now,deadlineMs:1000});
    try {assert.deepEqual(await resolveAvailableTools(prepared,rt),[]);assert.equal(authorized,0);assert.ok("denial" in resolveToolCall(exampleTool.name,prepared,[]));}finally{rt.dispose();}
  }
  const input=scopeFixture(["STANDALONE"]);
  assert.ok(CommerceManifestSchema.safeParse(input.manifest).success);
  assert.ok(manifestMatchesGrant(input.manifest,input.grant));
  const prepared=prepareCommerceTurn(input),rt=createCommerceTurnRuntime({callerSignal:input.signal,now:input.dependencies.now,deadlineMs:1000});
  try {
    const tools=await resolveAvailableTools(prepared,rt);assert.equal(tools.length,1);assert.ok("tool" in resolveToolCall(exampleTool.name,prepared,tools));
    input.dependencies.tools[0]!.descriptor={...input.dependencies.tools[0]!.descriptor,description:"forged pinned tool"};
    assert.throws(()=>resolveToolCall(exampleTool.name,prepared,tools));
  }finally{rt.dispose();}
  const mismatch=scopeFixture(["STANDALONE"]);delete (mismatch.manifest.grantedTools[0] as any).allowedConversationScopes;
  assert.equal(CommerceManifestSchema.safeParse(mismatch.manifest).success,false);
  const forged=scopeFixture();(forged.grant.grantedTools[0] as any).allowedConversationScopes=["STANDALONE"];
  assert.throws(()=>prepareCommerceTurn(forged));
  for(const scopes of [[],["STANDALONE","STANDALONE"],["ANY"],["RECOVERY","STANDALONE","RECOVERY"]])
    assert.equal(CommerceManifestSchema.safeParse({...input.manifest,capabilities:input.manifest.capabilities.map(c=>({...c,toolDescriptor:{...c.toolDescriptor,allowedConversationScopes:scopes}}))}).success,false);
});

test("standalone runner denies recovery outreach/mismatched/expired grants before model or provider I/O",async()=>{
  const input=scopeFixture(["STANDALONE"]);let calls=0;
  input.dependencies.model.invoke=async()=>{calls++;return {calls:[],outputTokens:1,text:"Please contact the store."};};
  input.dependencies.tools[0]!.isAuthorized=async()=>{calls++;return true;};
  for(const invalid of [
    {...input,executionPurpose:"INITIAL_RECOVERY_OUTREACH" as const},
    {...input,grant:{...input.grant,conversationScope:"RECOVERY" as const,checkoutRecoveryId:"real"}},
    {...input,grant:{...input.grant,expiresAt:new Date(now).toISOString()}},
  ]){const result=await runCommerceTurn(invalid);assert.equal(result.ok,false);assert.equal(calls,0);}
  const noTool=fixture();noTool.turn=standalone();noTool.grant.conversationScope="STANDALONE";
  const result=await runCommerceTurn(noTool);assert.equal(result.ok,true);
  assert.equal("checkoutRecoveryId" in noTool.turn,false);assert.deepEqual(noTool.context,{});
});

test("standalone safe read executes only with pinned marker and independent current authorization",async()=>{
  const input=scopeFixture(["STANDALONE"]);let models=0,executions=0,authorizations=0;
  input.dependencies.model.invoke=async()=>++models===1
    ? {calls:[{name:exampleTool.name,arguments:{handle:"fixture"}}],outputTokens:1}
    : {calls:[],outputTokens:1,text:"Please contact the store for more information."};
  input.dependencies.tools[0]!.isAuthorized=async()=>{authorizations++;return true;};
  input.dependencies.tools[0]!.execute=async(args)=>{assert.deepEqual(args,{handle:"fixture"});executions++;return {contractVersion:"commerce.v1",status:"OK",data:{},renderedText:"fixture"};};
  const result=await runCommerceTurn(input);
  assert.equal(result.ok,true);assert.equal(executions,1);assert.ok(authorizations>=2);assert.equal(models,2);
  assert.equal("checkoutRecoveryId" in input.turn,false);assert.deepEqual(input.context,{});
  const revoked=scopeFixture(["STANDALONE"]);
  revoked.dependencies.tools[0]!.isAuthorized=async()=>false;
  revoked.dependencies.tools[0]!.execute=async()=>{assert.fail("scope marker never replaces current authorization");};
  const prepared=prepareCommerceTurn(revoked),rt=createCommerceTurnRuntime({callerSignal:revoked.signal,now:revoked.dependencies.now,deadlineMs:1000});
  try{assert.deepEqual(await resolveAvailableTools(prepared,rt),[]);}finally{rt.dispose();}
});
