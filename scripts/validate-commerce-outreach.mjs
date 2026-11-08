import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'moda-outreach-pack-'));
try{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],{cwd:root,encoding:'utf8'}))[0];
 for(const file of ['dist/commerce/outreach/index.js','dist/commerce/outreach/index.d.ts'])assert.ok(packed.files.some(f=>f.path===file));
 writeFileSync(join(temp,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',join(temp,packed.filename)],{cwd:temp,stdio:'pipe'});
 const packageRoot=join(temp,'node_modules/@modainteract/moda-interact-shared');
 const declarations=readFileSync(join(packageRoot,'dist/commerce/outreach/index.d.ts'),'utf8');
 assert.ok(!/moda-interact-background|moda-interact-commerce|@prisma\/client/.test(declarations));
 writeFileSync(join(temp,'types.mts'),`import {InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema,evaluateInitialOutreach,evaluateInitialOutreachPreview,renderInitialOutreachPreview,fingerprintInitialOutreachBasket,type InitialOutreachEvaluationInput,type InitialOutreachEvaluationResult,type InitialOutreachRenderInput,type InitialOutreachRenderResult,type InitialOutreachPorts,type InitialOutreachToolCall} from '@modainteract/moda-interact-shared/commerce/outreach';\nconst schemas=[InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema]; const evaluator: typeof evaluateInitialOutreach=evaluateInitialOutreachPreview;`);
 execFileSync(resolve(root,'node_modules/.bin/tsc'),['--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(temp,'types.mts')],{cwd:temp,stdio:'pipe'});
 const smoke=`
 import assert from 'node:assert/strict';
 import {createHash} from 'node:crypto';
 import {InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema,evaluateInitialOutreach,evaluateInitialOutreachPreview,renderInitialOutreachPreview,fingerprintInitialOutreachBasket} from '@modainteract/moda-interact-shared/commerce/outreach';
 import {CommerceProductDescriptionSchema,CommerceProductAttributesSchema} from '@modainteract/moda-interact-shared/commerce';
 import {normalizeCommerceReplyText,verifyCommerceProductFacts,CommerceVerifiedPresentationSchema} from '@modainteract/moda-interact-shared/commerce/presentation';
 const at='2026-11-08T17:00:00.000Z';
 const input={schemaVersion:1,runId:'pack-run',shopId:'pack-shop',platform:'WOOCOMMERCE',environment:'TEST',checkout:{id:'checkout-1',generation:1,currency:'USD',url:'https://shop.example/checkout',lines:[{lineKey:'line-1',productId:'1',variantId:null,quantity:2,checkoutUnitPrice:'10.00'}]},policy:{mode:'NONE',authorisedDiscountIds:[]},instructions:{platformText:'Safety',platformRevisionId:'p1',merchantText:null,merchantRevisionId:null,purposeText:'Checkout only',purposeProfileRevisionId:'purpose1'},limits:{deadlineMs:1000,modelSteps:1,remoteCalls:2,outputTokens:100}};
 assert.ok(InitialOutreachEvaluationInputSchema.safeParse(input).success);assert.equal(InitialOutreachEvaluationInputSchema.safeParse({...input,extra:true}).success,false);
 assert.equal(evaluateInitialOutreach,evaluateInitialOutreachPreview);let calls=0;
 const result=await evaluateInitialOutreach(input,{signal:new AbortController().signal,now:()=>new Date(at),log(){},modelInvoker:{invoke(){throw new Error('NONE must not use model');}},async callTool(call){calls++;assert.equal(call.name,'commerce_get_product');return {product:{productId:'1',variantId:null,title:'Custom item',url:null,available:true,unitPrice:'12.00',currency:'USD',productType:null,vendor:null,observedAt:at,description:{status:'AVAILABLE',text:'Merchant description'},attributes:{status:'AVAILABLE',items:[{name:'Unit',values:['15 ml']}]}}};}});
 assert.equal(calls,2);assert.equal(result.kind,'ready');assert.ok(InitialOutreachEvaluationResultSchema.safeParse(result).success);assert.equal(result.currentMerchandiseSubtotal.amountDecimal,'24.00');assert.equal(result.basketFingerprint,fingerprintInitialOutreachBasket(input));
 const render={schemaVersion:1,evaluation:result,preparedProjection:null,variables:{shopName:'Merchant',customerFirstName:'Test customer',checkoutUrl:input.checkout.url,shopCategory:null},headerMedia:null};
 assert.ok(InitialOutreachRenderInputSchema.safeParse(render).success);const rendered=renderInitialOutreachPreview(render);assert.deepEqual(rendered,{kind:'refused',reasonCode:'NO_APPROVED_ASSIGNMENT'});assert.ok(InitialOutreachRenderResultSchema.safeParse(rendered).success);

 const components=[{type:'BODY',text:'{{1}}: {{2}}'}];
 const bindings={promotionTarget:'CHECKOUT',header:[],body:[{position:1,variable:'shop.name'},{position:2,variable:'checkout.itemsSummary'}],buttons:[]};
 const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,w])=>JSON.stringify(k)+':'+stable(w)).join(',')+'}';
 const hash=createHash('sha256').update(stable({schemaVersion:1,family:'META_RECOVERY',category:'MARKETING',components,parameterBindings:bindings})).digest('hex');
 const registration={id:'reg1',wabaId:'waba1',providerTemplateName:'initial_no_offer',providerLanguageCode:'en',providerTemplateId:'meta1',category:'MARKETING',providerStatus:'APPROVED',submissionState:'SUBMITTED',failureCode:null,lastObservedContentHash:hash,lastObservedCategory:'MARKETING',driftDetectedAt:null,submittedContentHash:hash,componentsSnapshot:components,parameterBindingsSnapshot:bindings,locale:{id:'locale1',languageTag:'en',providerLanguageCode:'en',status:'REVIEWED',contentHash:hash,definition:{id:'def1',kind:'META_RECOVERY',purpose:'INITIAL',offerType:'NO_OFFER',status:'PUBLISHED',category:'MARKETING',providerTemplateName:'initial_no_offer',publishedAt:at,retiredAt:null}}};
 render.preparedProjection={variant:{id:'variant1',shopId:input.shopId,providerAccountId:'waba1',purpose:'INITIAL_NO_OFFER',languageTag:'en',providerLanguageCode:'en',providerTemplateName:'initial_no_offer',providerTemplateId:'meta1',status:'APPROVED',enabled:true,metaRegistrationId:'reg1',metaRegistration:registration},canonicalLanguageTag:'en',selectionSource:'exact'};
 const message=renderInitialOutreachPreview(render);assert.equal(message.kind,'ready');assert.equal(message.renderedText,'Merchant: 2 × Custom item');assert.equal(message.templateProvenance.bindingFingerprint,hash);assert.deepEqual(message.parameters,[{type:'body',parameters:[{type:'text',text:'Merchant'},{type:'text',text:'2 × Custom item'}]}]);
 assert.equal(normalizeCommerceReplyText('**Compatible**'),'Compatible');const facts=verifyCommerceProductFacts([{productId:'1',variantId:null}],[result.lines[0].currentProduct]);assert.equal(facts.kind,'verified');assert.ok(CommerceVerifiedPresentationSchema.safeParse({schemaVersion:1,brandName:'Merchant',locale:'en',disposition:'PRODUCT_DETAILS',storeUrl:'https://shop.example/',products:[],productFacts:facts.productFacts,optionFacts:[],requiresShipping:null,policyUrl:null,includeNoVerifiedOffer:false}).success);assert.ok(CommerceProductAttributesSchema.safeParse(result.lines[0].currentProduct.attributes).success);assert.ok(CommerceProductDescriptionSchema.safeParse(result.lines[0].currentProduct.description).success);
 console.log('Packed outreach public JS/declarations, evaluation/frozen render and generic product imports passed');`;
 writeFileSync(join(temp,'smoke.mjs'),smoke);
 execFileSync(process.execPath,[join(temp,'smoke.mjs')],{cwd:temp,stdio:'inherit'});
}finally{rmSync(temp,{recursive:true,force:true});}
