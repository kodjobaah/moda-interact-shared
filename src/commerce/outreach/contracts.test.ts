import test from 'node:test';
import assert from 'node:assert/strict';
import {InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,RefusalReasonSchema} from './contracts.js';
import {fixture, preparedBrandFixture, preparedBrandMediaFixture} from './test-fixtures.js';
test('strict contracts close refusal taxonomy and reject duplicate/native-parent/merchant-revision inputs',()=>{
 assert.equal(RefusalReasonSchema.safeParse('invented_reason').success,false);
 const i=fixture();i.checkout.lines.push({...i.checkout.lines[0]!});assert.equal(InitialOutreachEvaluationInputSchema.safeParse(i).success,false);
 const j=fixture();j.checkout.lines[0]!.variantId='gid://shopify/Product/2';assert.equal(InitialOutreachEvaluationInputSchema.safeParse(j).success,false);
 const k=fixture();k.instructions.merchantText='preferences';assert.equal(InitialOutreachEvaluationInputSchema.safeParse(k).success,false);
 const refused={kind:'refused',schemaVersion:1,runId:'r',shopId:'s',stage:'INPUT',reasonCode:'INPUT_INVALID',lineKey:null,toolActivity:[]};assert.ok(InitialOutreachEvaluationResultSchema.safeParse(refused).success);assert.equal(InitialOutreachEvaluationResultSchema.safeParse({...refused,renderedText:'must not render refusal'}).success,false);
});

import {PreparedOutreachBrandSchema,PreparedOutreachBrandMediaSchema,PreparedOutreachBrandMediaItemSchema} from './template-contracts.js';
import {https} from './contracts.js';
test('prepared projections use exact strict required keys, nullable absence and bounded typed values',()=>{
 const brand=preparedBrandFixture(),media=preparedBrandMediaFixture();
 assert.ok(PreparedOutreachBrandSchema.safeParse(brand).success);assert.ok(PreparedOutreachBrandMediaSchema.safeParse(media).success);
 for(const key of Object.keys(brand)){const missing:any={...brand};delete missing[key];assert.equal(PreparedOutreachBrandSchema.safeParse(missing).success,false);}
 for(const key of Object.keys(media)){const missing:any={...media};delete missing[key];assert.equal(PreparedOutreachBrandMediaSchema.safeParse(missing).success,false);}
 assert.equal(PreparedOutreachBrandSchema.safeParse({...brand,brandName:'x'.repeat(201)}).success,false);
 assert.equal(PreparedOutreachBrandSchema.safeParse({...brand,logoUrl:'https://assets.example/raw.png'}).success,false);
 assert.equal(PreparedOutreachBrandMediaSchema.safeParse({...media,originalUrl:'https://assets.example/raw.png'}).success,false);
 assert.ok(PreparedOutreachBrandSchema.safeParse({...brand,brandName:null,logoAltText:null,logoWidth:null,logoHeight:null,squareLogoAltText:null}).success);
 assert.ok(PreparedOutreachBrandMediaSchema.safeParse({logo:null,squareLogo:null,coverImage:null}).success);
 for(const invalid of ['malformed','http://assets.example/a','https://u:p@assets.example/a']){assert.doesNotThrow(()=>https.safeParse(invalid));assert.equal(https.safeParse(invalid).success,false);assert.equal(PreparedOutreachBrandMediaItemSchema.safeParse({...media.logo!,httpsUrl:invalid}).success,false);}
 for(const key of Object.keys(media.logo!)){const missing:any={...media.logo};delete missing[key];assert.equal(PreparedOutreachBrandMediaItemSchema.safeParse(missing).success,false);}
 assert.equal(PreparedOutreachBrandMediaItemSchema.safeParse({...media.logo!,extra:true}).success,false);
});
