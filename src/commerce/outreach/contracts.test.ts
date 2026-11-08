import test from 'node:test';
import assert from 'node:assert/strict';
import {InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,RefusalReasonSchema} from './contracts.js';
import {fixture} from './test-fixtures.js';
test('strict contracts close refusal taxonomy and reject duplicate/native-parent/merchant-revision inputs',()=>{
 assert.equal(RefusalReasonSchema.safeParse('invented_reason').success,false);
 const i=fixture();i.checkout.lines.push({...i.checkout.lines[0]!});assert.equal(InitialOutreachEvaluationInputSchema.safeParse(i).success,false);
 const j=fixture();j.checkout.lines[0]!.variantId='gid://shopify/Product/2';assert.equal(InitialOutreachEvaluationInputSchema.safeParse(j).success,false);
 const k=fixture();k.instructions.merchantText='preferences';assert.equal(InitialOutreachEvaluationInputSchema.safeParse(k).success,false);
 const refused={kind:'refused',schemaVersion:1,runId:'r',shopId:'s',stage:'INPUT',reasonCode:'INPUT_INVALID',lineKey:null,toolActivity:[]};assert.ok(InitialOutreachEvaluationResultSchema.safeParse(refused).success);assert.equal(InitialOutreachEvaluationResultSchema.safeParse({...refused,renderedText:'must not render refusal'}).success,false);
});
