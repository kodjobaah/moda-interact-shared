import { spawnSync } from "node:child_process";
const code = `
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as c from '@modainteract/moda-interact-shared/commerce';
import {runCommerceTurn,runnerVersion} from '@modainteract/moda-interact-shared/commerce/runner';
const digest=s=>createHash('sha256').update(s).digest('hex');
const manifest=c.exampleManifest(digest);
assert(c.CommerceManifestSchema.safeParse(manifest).success);
const result=await runCommerceTurn({turn:c.exampleTurn,grant:c.exampleGrant(manifest),manifest,prompts:manifest.capabilities.map(x=>({name:x.promptName,text:'Fixture only'})),hostInstructions:[],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,dependencies:{digest,now:()=>Date.now(),tools:[],model:{invoke:async()=>({calls:[{name:'finalResponse',arguments:c.exampleFinal}],outputTokens:30})}}});
assert(result.ok);assert.equal(runnerVersion,'1.0.0');
const oversized={name:'oversize_tool',definitionVersion:'1.0.0',description:'Fixture',inputSchema:{},execution:{x:'x'.repeat(40000)},responseTemplate:{x:'x'.repeat(40000)}};
assert.equal(c.CommerceToolDraftDefinitionSchema.safeParse(oversized).success,false);
const malformed=await runCommerceTurn({turn:c.exampleTurn,grant:c.exampleGrant(manifest),manifest,prompts:manifest.capabilities.map(x=>({name:x.promptName,text:'Fixture only'})),hostInstructions:[],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,dependencies:{digest,now:()=>Date.now(),tools:[],model:{invoke:async()=>({calls:[null],outputTokens:1})}}});
assert.deepEqual(malformed,{ok:false,error:{code:'INVALID_FINAL',retryable:false}});
console.log('PASS commerce and commerce/runner clean-process imports, schema, scripted finalResponse and R1/R2 regressions');
`;
// Deliberately pass only basic runtime variables, never provider/database credentials.
const result = spawnSync(
  process.execPath,
  ["--input-type=module", "-e", code],
  {
    cwd: process.env.COMMERCE_CONSUMER_DIRECTORY || process.cwd(),
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  },
);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exitCode = result.status ?? 1;
