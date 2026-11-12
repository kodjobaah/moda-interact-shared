import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const commerceDeclarations = readFileSync(resolve("dist/commerce/index.d.ts"), "utf8");
for (const name of ["CommerceConversationToolContextSchema", "CommerceConversationToolContext"])
 assert.equal(commerceDeclarations.includes(name), false, `${name} remains in built Commerce declarations`);
const code = `
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as c from '@modainteract/moda-interact-shared/commerce';
import {runCommerceTurn,runnerVersion} from '@modainteract/moda-interact-shared/commerce/runner';
const digest=s=>createHash('sha256').update(s).digest('hex');
const providerEnvelope=c.finalResponseToolSchema(c.EMPTY_RESPONSE_CONTRACT);
assert.deepEqual(providerEnvelope.properties.referralReason.type,['string','null']);
assert.deepEqual(providerEnvelope.properties.referralReason.enum,[null,...c.ReferralReasonSchema.options]);

const rec={scope:'PRODUCT_ONLY',basketLineId:null,productId:'installed-product',variantId:null,quantity:1,promotionKind:'NONE',offerIds:[]};
assert.deepEqual(c.readCommerceRecommendationSelection({productRecommendations:[rec],responseDisposition:'STANDARD'}),{responseDisposition:'STANDARD'});
assert.deepEqual(c.readCommerceRecommendationSelection({productRecommendationVersion:'1',productRecommendations:[rec]}).productRecommendations,[rec]);
assert.equal(c.isCommerceShippingObservationForSelection({selection:{productId:null,variantId:null},observation:{},provider:'SHOPIFY'}),false);
for(const name of ['hasCommerceAcceptedProductSelection','hasCanonicalCommerceRecommendationContract','readCommerceObservedShippingSelections'])assert.equal(typeof c[name],'function');

const promptValidation=c.validateStoreCategoryPromptTemplate({source:'Base {% if mappings.shoes %}shoe{% endif %}',availableConditionKeys:['shoes']});
assert.equal(promptValidation.valid,true);
const promptContext=c.createStoreCategoryPromptContext({availableConditionKeys:['shoes'],selectedConditionKeys:['shoes']});
const promptRendered=c.renderStoreCategoryPromptTemplate({source:'Base {% if mappings.shoes %}shoe{% endif %}',context:promptContext});
assert.deepEqual(promptRendered,{ok:true,promptText:'Base shoe',referencedConditionKeys:['shoes']});
for (const name of ['CommerceShippingInformationInputSchema','CommerceShippingInformationSchema','CommerceResponseDispositionSchema','CommerceAnswerPresentationSelectionSchema','CommerceCategoryCandidateSchema','CommerceCategoryResolutionSchema','CommerceOptionalLookupUnavailableSchema','CommerceTurnIdentitySchema','CommerceResolveAssertionSchema','CommerceExecuteAssertionSchema','CommerceAssertionSchema','CommerceConversationGrantSchema','CommerceOutreachToolContextSchema','CommerceBuiltInToolDescriptorSchema','CommerceBuiltInToolGrantSchema','CommerceProductRecommendationSelectionSchema','commerceDiscountBuiltInDescriptors']) assert(name in c, name);
for (const name of ['CommerceConversationToolContextSchema','CommerceConversationToolContext']) assert.equal(name in c, false, name);
assert.equal('commerceBuiltInToolContractPayload' in c, false);
for (const descriptor of c.commerceDiscountBuiltInDescriptors) {
 assert(c.CommerceBuiltInToolDescriptorSchema.safeParse(descriptor).success);
 assert.equal(descriptor.definitionVersion,'2.0.0');
 assert.equal('contractHash' in descriptor,false);
}
const builtInGrant={kind:'BUILT_IN',toolName:'commerce_get_discount_options',definitionVersion:'2.0.0'};
assert(c.CommerceBuiltInToolGrantSchema.safeParse(builtInGrant).success);
assert.equal(c.CommerceBuiltInToolGrantSchema.safeParse({...builtInGrant,definitionVersion:'1.0.0'}).success,false);
assert.equal(c.CommerceBuiltInToolDescriptorSchema.safeParse({...c.commerceDiscountBuiltInDescriptors[0],definitionVersion:'1.0.0'}).success,false);
assert.equal(c.CommerceBuiltInToolGrantSchema.safeParse({...builtInGrant,contractHash:'0'.repeat(64)}).success,false);
assert.deepEqual(c.CommerceShippingInformationInputSchema.parse({}),{productId:null,variantId:null});
assert.equal(c.CommerceToolInputs.commerce_search_products.parse({}).browse,false);
assert(c.CommerceAnswerPresentationSelectionSchema.safeParse({responseDisposition:'STANDARD',shippingInformationSelection:{productId:null,variantId:null}}).success);
const detailPair={productId:'p1',variantId:null};
assert(c.CommerceAnswerPresentationSelectionSchema.safeParse({responseDisposition:'PRODUCT_DETAILS',productDetailSelections:[detailPair]}).success);
assert.equal(c.verifyCommerceAnswerPresentationSelection({productDetailSelections:[detailPair],productOptionSelections:[detailPair]}).reason,'INVALID_SELECTION');
assert.equal(c.CommerceAnswerPresentationSelectionSchema.safeParse({productDetailSelections:[detailPair,detailPair]}).success,false);
const manifest=c.exampleManifest(digest);
assert(c.CommerceManifestSchema.safeParse(manifest).success);
const result=await runCommerceTurn({turn:c.exampleTurn,grant:c.exampleGrant(manifest),manifest,hostInstructions:[],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,dependencies:{digest,now:()=>Date.now(),tools:[],model:{invoke:async()=>({calls:[{name:'finalResponse',arguments:c.exampleFinal}],outputTokens:30})}}});
assert(result.ok);assert.equal(runnerVersion,'1.1.0');
const oversized={name:'oversize_tool',definitionVersion:'1.0.0',description:'Fixture',inputSchema:{},execution:{x:'x'.repeat(40000)},responseTemplate:{x:'x'.repeat(40000)}};
assert.equal(c.CommerceToolDraftDefinitionSchema.safeParse(oversized).success,false);
const malformed=await runCommerceTurn({turn:c.exampleTurn,grant:c.exampleGrant(manifest),manifest,hostInstructions:[],context:{},history:[],language:{tag:null,source:null},signal:new AbortController().signal,dependencies:{digest,now:()=>Date.now(),tools:[],model:{invoke:async()=>({calls:[null],outputTokens:1})}}});
assert.equal(malformed.ok, false);
assert.deepEqual(
  { code: malformed.error.code, retryable: malformed.error.retryable },
  { code: 'INVALID_FINAL', retryable: false },
);
assert.equal(malformed.error.diagnostic?.stage, 'model.validate');
assert.equal(malformed.error.diagnostic?.reasonCode, 'MODEL_TOOL_CALL_NULL');
assert.equal(malformed.error.diagnostic?.callIndex, 0);
assert.match(malformed.error.diagnostic?.reasonMessage ?? '', /null tool-call entry at index 0/i);
assert.match(malformed.error.diagnostic?.operatorAction ?? '', /tool-call conversion/i);
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
