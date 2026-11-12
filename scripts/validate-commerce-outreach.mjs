import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'moda-outreach-pack-'));
try{
 const suppliedTarball=process.argv[2];
 let tarball;
 if(suppliedTarball){
  tarball=resolve(suppliedTarball);
 }else{
  const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',temp],{cwd:root,encoding:'utf8'}))[0];
  tarball=join(temp,packed.filename);
 }
 const files=new Set(execFileSync('tar',['-tzf',tarball],{encoding:'utf8'}).trim().split('\n').map(path=>path.replace(/^package\//,'')));
 const manifest=JSON.parse(execFileSync('tar',['-xOf',tarball,'package/package.json'],{encoding:'utf8'}));
 assert.equal(manifest.name,'@modainteract/moda-interact-shared');
 for(const target of Object.values(manifest.exports).flatMap(value=>typeof value==='string'?[value]:Object.values(value))){
  assert.ok(files.has(target.replace(/^\.\//,'')),`Missing packed public export: ${target}`);
 }
 for(const file of ['dist/commerce/outreach/index.js','dist/commerce/outreach/index.d.ts'])assert.ok(files.has(file));
 writeFileSync(join(temp,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',tarball],{cwd:temp,stdio:'pipe'});
 console.log(`Validating installed ${manifest.name}@${manifest.version} from ${suppliedTarball?'supplied immutable tarball':'local pack'}; all public export targets present`);
 const packageRoot=join(temp,'node_modules/@modainteract/moda-interact-shared');
 const declarations=readFileSync(join(packageRoot,'dist/commerce/outreach/index.d.ts'),'utf8');
 assert.ok(!/moda-interact-background|moda-interact-commerce|@prisma\/client/.test(declarations));
 writeFileSync(join(temp,'types.mts'),`import {StudioOutreachTemplateSchema,StudioInitialOutreachRenderInputSchema,StudioInitialOutreachRenderResultSchema,ComponentSchema,FrozenBindingsSchema,renderStudioInitialOutreachPreview,selectSendableOutreachOffer,purposeFor,PreparedOutreachBrandSchema,PreparedOutreachBrandMediaSchema,PreparedOutreachBrandMediaItemSchema,InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema,evaluateInitialOutreach,evaluateInitialOutreachPreview,renderInitialOutreachPreview,fingerprintInitialOutreachBasket,type StudioOutreachTemplate,type StudioInitialOutreachRenderInput,type StudioInitialOutreachRenderResult,type SendableOutreachOffer,type PreparedOutreachBrand,type PreparedOutreachBrandMedia,type PreparedOutreachBrandMediaItem,type InitialOutreachEvaluationInput,type InitialOutreachEvaluationResult,type InitialOutreachRenderInput,type InitialOutreachRenderResult,type InitialOutreachPorts,type InitialOutreachToolCall} from '@modainteract/moda-interact-shared/commerce/outreach';\nimport {CommerceProductStockSchema,normalizeCommerceStockQuantity,recordCommerceProductPresentation,type CommerceProductStock,type CommerceConversationProductContext} from '@modainteract/moda-interact-shared/commerce';\nimport {CommerceProductFactSchema,type CommerceProductFact} from '@modainteract/moda-interact-shared/commerce/presentation';\nconst stock:CommerceProductStock={status:'KNOWN',quantity:0,scope:'VARIANT'};const schemas=[StudioOutreachTemplateSchema,StudioInitialOutreachRenderInputSchema,StudioInitialOutreachRenderResultSchema,ComponentSchema,FrozenBindingsSchema,renderStudioInitialOutreachPreview,selectSendableOutreachOffer,purposeFor,PreparedOutreachBrandSchema,PreparedOutreachBrandMediaSchema,PreparedOutreachBrandMediaItemSchema,InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema]; const evaluator: typeof evaluateInitialOutreach=evaluateInitialOutreachPreview;`);
 execFileSync(resolve(root,'node_modules/.bin/tsc'),['--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',join(temp,'types.mts')],{cwd:temp,stdio:'pipe'});
 const smoke=`
 import assert from 'node:assert/strict';
 import {createHash} from 'node:crypto';
 import {StudioOutreachTemplateSchema,StudioInitialOutreachRenderInputSchema,StudioInitialOutreachRenderResultSchema,ComponentSchema,FrozenBindingsSchema,renderStudioInitialOutreachPreview,selectSendableOutreachOffer,purposeFor,PreparedOutreachBrandSchema,PreparedOutreachBrandMediaSchema,PreparedOutreachBrandMediaItemSchema,InitialOutreachEvaluationInputSchema,InitialOutreachEvaluationResultSchema,InitialOutreachRenderInputSchema,InitialOutreachRenderResultSchema,evaluateInitialOutreach,evaluateInitialOutreachPreview,renderInitialOutreachPreview,fingerprintInitialOutreachBasket} from '@modainteract/moda-interact-shared/commerce/outreach';
 import {z} from 'zod';
 import {compileCommercePurposeOutputSchema,CommerceProductStockSchema,CommerceProductSchema,CommerceToolOutputs,normalizeCommerceStockQuantity,recordCommerceProductPresentation,mergeConversationProductContext,CommerceProductDescriptionSchema,CommerceProductAttributesSchema} from '@modainteract/moda-interact-shared/commerce';
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
 const observed=v=>createHash('sha256').update(stable(JSON.parse(JSON.stringify(v,(key,value)=>key==='example'?undefined:value)))).digest('hex');
 const hash=createHash('sha256').update(stable({schemaVersion:1,family:'META_RECOVERY',category:'MARKETING',components,parameterBindings:bindings})).digest('hex');
 const registration={id:'reg1',wabaId:'waba1',providerTemplateName:'initial_no_offer',providerLanguageCode:'en',providerTemplateId:'meta1',category:'MARKETING',providerStatus:'APPROVED',submissionState:'SUBMITTED',failureCode:null,lastObservedContentHash:observed(components),lastObservedCategory:'MARKETING',driftDetectedAt:null,submittedContentHash:hash,componentsSnapshot:components,parameterBindingsSnapshot:bindings,locale:{id:'locale1',languageTag:'en',providerLanguageCode:'en',status:'REVIEWED',contentHash:hash,definition:{id:'def1',kind:'META_RECOVERY',purpose:'INITIAL',offerType:'NO_OFFER',status:'PUBLISHED',category:'MARKETING',providerTemplateName:'initial_no_offer',publishedAt:at,retiredAt:null}}};
 render.preparedProjection={variant:{id:'variant1',shopId:input.shopId,providerAccountId:'waba1',purpose:'INITIAL_NO_OFFER',languageTag:'en',providerLanguageCode:'en',providerTemplateName:'initial_no_offer',providerTemplateId:'meta1',status:'APPROVED',enabled:true,metaRegistrationId:'reg1',metaRegistration:registration},canonicalLanguageTag:'en',selectionSource:'exact'};
 const message=renderInitialOutreachPreview(render);assert.equal(message.kind,'ready');assert.equal(message.renderedText,'Merchant: 2 × Custom item');assert.equal(message.templateProvenance.bindingFingerprint,hash);
 const {preparedProjection,...studioFacts}=render;const studioInput={...studioFacts,template:{templateId:'stored1',localeId:'locale1',languageTag:'en',components,bindings}};assert.ok(StudioOutreachTemplateSchema.safeParse(studioInput.template).success);assert.ok(StudioInitialOutreachRenderInputSchema.safeParse(studioInput).success);const studio=renderStudioInitialOutreachPreview(studioInput);assert.ok(StudioInitialOutreachRenderResultSchema.safeParse(studio).success);assert.equal(studio.kind,'ready');assert.equal(studio.templateValidation,'NOT_EVALUATED');assert.deepEqual(studio.parameters,message.parameters);assert.equal(studio.renderedText,message.renderedText);assert.equal(purposeFor('INITIAL',selectSendableOutreachOffer(result.offerDecision).presentation),'INITIAL_NO_OFFER');assert.ok(ComponentSchema.safeParse(components[0]).success);assert.ok(FrozenBindingsSchema.safeParse(bindings).success);
assert.deepEqual(message.parameters,[{type:'body',parameters:[{type:'text',text:'Merchant'},{type:'text',text:'2 × Custom item'}]}]);

 render.preparedBrand=PreparedOutreachBrandSchema.parse({shopId:input.shopId,brandName:'Saved brand',logoAltText:'Saved logo alt',logoWidth:100,logoHeight:200,squareLogoAltText:'Saved square alt'});
 render.variables.shopName='Generic merchant';
 registration.componentsSnapshot=[{type:'BODY',text:'{{1}} | {{2}} | {{3}} | {{4}} | {{5}} | {{6}} | {{7}}'}];
 registration.parameterBindingsSnapshot={promotionTarget:'CHECKOUT',header:[],body:['shop.name','checkout.itemsSummary','shopBrand.brandName','shopBrand.logoAltText','shopBrand.logoWidth','shopBrand.logoHeight','shopBrand.squareLogoAltText'].map((variable,n)=>({position:n+1,variable})),buttons:[]};
 const brandHash=createHash('sha256').update(stable({schemaVersion:1,family:'META_RECOVERY',category:'MARKETING',components:registration.componentsSnapshot,parameterBindings:registration.parameterBindingsSnapshot})).digest('hex');
 registration.submittedContentHash=brandHash;registration.lastObservedContentHash=observed(registration.componentsSnapshot);registration.locale.contentHash=brandHash;
 const brandResult=renderInitialOutreachPreview(render);assert.equal(brandResult.kind,'ready');assert.equal(brandResult.renderedText,'Generic merchant | 2 × Custom item | Saved brand | Saved logo alt | 100 | 200 | Saved square alt');
 assert.deepEqual(brandResult.parameters,[{type:'body',parameters:['Generic merchant','2 × Custom item','Saved brand','Saved logo alt','100','200','Saved square alt'].map(text=>({type:'text',text}))}]);
 assert.equal(brandResult.templateProvenance.bindingFingerprint,brandHash);
 const legacy=structuredClone(render);legacy.preparedProjection.variant.metaRegistration.parameterBindingsSnapshot={...legacy.preparedProjection.variant.metaRegistration.parameterBindingsSnapshot,schemaVersion:1,sourceHash:'b'.repeat(64),localeContentHash:brandHash};
 const legacyResult=renderInitialOutreachPreview(legacy);assert.equal(legacyResult.kind,'ready');assert.equal(legacyResult.templateProvenance.bindingFingerprint,brandHash);
 assert.ok(PreparedOutreachBrandMediaSchema.safeParse({logo:null,squareLogo:null,coverImage:null}).success);
 assert.ok(PreparedOutreachBrandMediaItemSchema.safeParse({shopId:input.shopId,role:'LOGO',status:'READY',kind:'R2_DERIVATIVE',httpsUrl:'https://assets.example/logo.webp'}).success);
 assert.equal(InitialOutreachRenderInputSchema.safeParse({...render,variables:{...render.variables,checkoutUrl:'malformed'}}).success,false);
 assert.deepEqual(renderInitialOutreachPreview({...render,variables:{...render.variables,checkoutUrl:'malformed'}}),{kind:'refused',reasonCode:'INVALID_REQUEST'});
 assert.equal(normalizeCommerceReplyText('**Compatible**'),'Compatible');const facts=verifyCommerceProductFacts([{productId:'1',variantId:null}],[result.lines[0].currentProduct]);assert.equal(facts.kind,'verified');assert.ok(CommerceVerifiedPresentationSchema.safeParse({schemaVersion:1,brandName:'Merchant',locale:'en',disposition:'PRODUCT_DETAILS',storeUrl:'https://shop.example/',products:[],productFacts:facts.productFacts,optionFacts:[],requiresShipping:null,policyUrl:null,includeNoVerifiedOffer:false}).success);assert.ok(CommerceProductAttributesSchema.safeParse(result.lines[0].currentProduct.attributes).success);assert.ok(CommerceProductDescriptionSchema.safeParse(result.lines[0].currentProduct.description).success);
 assert.equal(normalizeCommerceStockQuantity(-3),0);assert.equal(normalizeCommerceStockQuantity(1.5),null);assert.ok(CommerceProductStockSchema.safeParse({status:'KNOWN',quantity:0,scope:'VARIANT'}).success);
 const outputSchema=z.toJSONSchema(CommerceToolOutputs.commerce_get_product);assert.ok(JSON.stringify(outputSchema).includes('stock'));const stockOutput=z.toJSONSchema(CommerceProductStockSchema);delete stockOutput.$schema;const stockCompiler=compileCommercePurposeOutputSchema({type:'object',properties:{stock:stockOutput},required:['stock'],additionalProperties:false});assert.deepEqual(stockCompiler.parse({stock:{status:'KNOWN',quantity:0,scope:'VARIANT'}}),{stock:{status:'KNOWN',quantity:0,scope:'VARIANT'}});
 const identity={shopId:input.shopId,conversationId:'public-conversation',platform:'WOOCOMMERCE',now:Date.parse(at)};
 const context=mergeConversationProductContext(null,[{toolName:'commerce_get_product',products:[CommerceProductSchema.parse({...result.lines[0].currentProduct,selectedOptions:[{name:'Volume',value:'15 ml'}],stock:{status:'KNOWN',quantity:0,scope:'PRODUCT'}})],observedAt:at}],identity);
 const presented=recordCommerceProductPresentation(context,[{productId:'1',variantId:null}],identity);assert.equal(presented.presentation.references[0].productId,'1');assert.equal(presented.references[0].selectedOptions[0].name,'Volume');assert.equal('stock' in presented.references[0],false);
 console.log('Packed outreach public JS/declarations, evaluation/frozen render and generic product imports passed');`;
 writeFileSync(join(temp,'smoke.mjs'),smoke);
 execFileSync(process.execPath,[join(temp,'smoke.mjs')],{cwd:temp,stdio:'inherit'});
}finally{rmSync(temp,{recursive:true,force:true});}
