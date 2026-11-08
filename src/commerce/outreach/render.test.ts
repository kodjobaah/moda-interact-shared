import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateInitialOutreach } from './evaluate.js';
import { renderInitialOutreachPreview } from './render.js';
import { InitialOutreachRenderInputSchema, InitialOutreachRenderResultSchema } from './template-contracts.js';
import { fixture, ports, renderFixture, stable, preparedBrandFixture, preparedBrandMediaFixture } from './test-fixtures.js';
async function input() {
    const r = await evaluateInitialOutreach(fixture(), ports().value);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        throw new Error('not ready');
    return renderFixture(r);
}
function rehash(i: Awaited<ReturnType<typeof input>>) { const r = i.preparedProjection!.variant.metaRegistration!; const h = createHash('sha256').update(stable({ schemaVersion: 1, family: 'META_RECOVERY', category: 'MARKETING', components: r.componentsSnapshot, parameterBindings: r.parameterBindingsSnapshot })).digest('hex'); r.submittedContentHash = h; r.lastObservedContentHash = h; r.locale.contentHash = h; }
test('frozen provider parameter/body/button/provenance golden', async () => {
    const i = await input();
    const r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready')
        return;
    assert.deepEqual(r.parameters, [{ type: 'body', parameters: [{ type: 'text', text: 'Test customer' }, { type: 'text', text: 'Merchant' }, { type: 'text', text: '2 × Custom label' }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'https%3A%2F%2Fshop.example%2Fcheckout%2F1' }] }]);
    assert.equal(r.renderedText, 'Hello Test customer from Merchant: 2 × Custom label');
    assert.equal(r.templateProvenance.registrationId, 'registration-1');
    assert.equal(r.templateProvenance.submittedContentHash, r.templateProvenance.bindingFingerprint);
    assert.equal(r.headerPreview, null);
    assert.ok(InitialOutreachRenderResultSchema.safeParse(r).success);
});
test('approved TEXT fallback when IMAGE has no READY media', async () => {
    const i = await input(), fallback = structuredClone(i.preparedProjection!);
    const r = i.preparedProjection!.variant.metaRegistration!;
    r.componentsSnapshot.unshift({ type: 'HEADER', format: 'IMAGE' });
    r.parameterBindingsSnapshot.schemaVersion = 1;
    r.parameterBindingsSnapshot.headerMediaRole = 'CHECKOUT_PRODUCT';
    rehash(i);
    assert.equal(renderInitialOutreachPreview(i).kind === 'refused' && (renderInitialOutreachPreview(i) as any).reasonCode, 'MEDIA_NOT_READY');
    i.preparedProjection!.textFallback = fallback;
    const text = renderInitialOutreachPreview(i);
    assert.equal(text.kind, 'ready');
    if (text.kind === 'ready')
        assert.equal(text.headerPreview, null);
    i.headerMedia = { shopId: 'shop-1', role: 'CHECKOUT_PRODUCT', status: 'READY', kind: 'R2_DERIVATIVE', httpsUrl: 'https://assets.example/ready.webp' };
    const image = renderInitialOutreachPreview(i);
    assert.equal(image.kind, 'ready');
    if (image.kind === 'ready')
        assert.deepEqual(image.parameters[0], { type: 'header', parameters: [{ type: 'image', image: { link: i.headerMedia.httpsUrl } }] });
});
for (const [expected, mutate] of [
    ['NO_APPROVED_ASSIGNMENT', (i: any) => { i.preparedProjection = null; }],
    ['IDENTITY_MISMATCH', (i: any) => { i.preparedProjection.variant.shopId = 'foreign'; }],
    ['LOCALE_UNAVAILABLE', (i: any) => { i.preparedProjection.variant.metaRegistration.locale.status = 'DRAFT'; }],
    ['PROVIDER_UNAVAILABLE', (i: any) => { i.preparedProjection.variant.metaRegistration.providerStatus = 'PAUSED'; }],
    ['BINDING_FINGERPRINT_MISMATCH', (i: any) => { i.preparedProjection.variant.metaRegistration.submittedContentHash = 'a'.repeat(64); i.preparedProjection.variant.metaRegistration.lastObservedContentHash = null; }],
    ['BINDING_VALUE_UNAVAILABLE', (i: any) => { i.variables.customerFirstName = 'bad\u0000'; }],
    ['INVALID_REQUEST', (i: any) => { i.preparedProjection.variant.metaRegistration.componentsSnapshot[0].extra = true; }],
] as const)
    test(`render refuses ${expected}`, async () => { const i = await input(); mutate(i); const r = renderInitialOutreachPreview(i); assert.equal(r.kind === 'refused' && r.reasonCode, expected); });
test('literal escapes/Unicode remain inert, controls/braces fail closed', async () => {
    const i = await input();
    i.variables.customerFirstName = 'Alex & <guest> 🪴';
    let r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready')
        assert.ok(r.renderedText.includes('Alex & <guest> 🪴'));
    for (const name of ['{{1}}', 'bad\ntext', '\ud800']) {
        i.variables.customerFirstName = name;
        r = renderInitialOutreachPreview(i);
        assert.equal(r.kind === 'refused' && r.reasonCode, 'BINDING_VALUE_UNAVAILABLE');
    }
});
test('4096 UTF16 body boundary refuses without truncating parameters', async () => {
    const i = await input(), r = i.preparedProjection!.variant.metaRegistration!;
    r.parameterBindingsSnapshot.body.push({ position: 4, variable: 'checkout.url' }, { position: 5, variable: 'checkout.url' });
    const body = r.componentsSnapshot[0]!;
    assert.ok('text' in body);
    if (!('text' in body))
        return;
    body.text = '{{1}}{{2}}{{3}}{{4}}{{5}}';
    i.variables.checkoutUrl = 'https://shop.example/' + 'x'.repeat(2027);
    rehash(i);
    const result = renderInitialOutreachPreview(i);
    assert.equal(result.kind === 'refused' && result.reasonCode, 'MESSAGE_TOO_LARGE');
    assert.ok(InitialOutreachRenderInputSchema.safeParse(i).success);
});
test('exact 4096 UTF16 body admitted; 4097 refused; header and footer preview text retained', async () => {
    const i = await input(), registration = i.preparedProjection!.variant.metaRegistration!;
    registration.parameterBindingsSnapshot.body.push({ position: 4, variable: 'checkout.url' }, { position: 5, variable: 'checkout.url' });
    const body = registration.componentsSnapshot[0]!;
    if (!('text' in body))
        throw new Error('body');
    i.variables.checkoutUrl = 'https://shop.example/' + 'x'.repeat(2000);
    const length = 'Test customer'.length + 'Merchant'.length + '2 × Custom label'.length + 2 * i.variables.checkoutUrl.length;
    body.text = 'a'.repeat(4096 - length) + '{{1}}{{2}}{{3}}{{4}}{{5}}';
    rehash(i);
    let r = renderInitialOutreachPreview(i);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready')
        assert.equal(r.renderedText.length, 4096);
    body.text += 'x';
    rehash(i);
    r = renderInitialOutreachPreview(i);
    assert.equal(r.kind === 'refused' && r.reasonCode, 'MESSAGE_TOO_LARGE');
    const j = await input(), reg = j.preparedProjection!.variant.metaRegistration!;
    reg.componentsSnapshot.unshift({ type: 'HEADER', format: 'TEXT', text: 'Welcome {{1}}' });
    reg.parameterBindingsSnapshot.header = [{ position: 1, variable: 'customer.firstName' }];
    reg.componentsSnapshot.splice(2, 0, { type: 'FOOTER', text: 'Footer' });
    rehash(j);
    r = renderInitialOutreachPreview(j);
    assert.equal(r.kind, 'ready');
    if (r.kind === 'ready') {
        assert.equal(r.renderedText, 'Welcome Test customer\nHello Test customer from Merchant: 2 × Custom label\nFooter');
        assert.deepEqual(r.parameters[0], { type: 'header', parameters: [{ type: 'text', text: 'Test customer' }] });
    }
});
// Fixed expected groups from Background's sendable method projection: largest
// method group wins; a tie preserves the first observed method.
for (const golden of [
    {methods:['CODE','AUTOMATIC'], selected:[0], presentation:'CODE_OFFER'},
    {methods:['AUTOMATIC','CODE'], selected:[0], presentation:'AUTOMATIC_OFFER'},
    {methods:['CODE','AUTOMATIC','CODE'], selected:[0,2], presentation:'CODE_OFFER'},
    {methods:['AUTOMATIC','CODE','AUTOMATIC'], selected:[0,2], presentation:'AUTOMATIC_OFFER'},
    {methods:['CODE'], selected:[0], presentation:'CODE_OFFER'},
    {methods:['CODE','CODE'], selected:[0,1], presentation:'CODE_OFFER'},
    {methods:['CODE','CODE','CODE'], selected:[0,1,2], presentation:'CODE_OFFER'},
    {methods:['AUTOMATIC'], selected:[0], presentation:'AUTOMATIC_OFFER'},
    {methods:['AUTOMATIC','AUTOMATIC'], selected:[0,1], presentation:'AUTOMATIC_OFFER'},
] as const) {
    test(`sendable method golden: ${golden.methods.join('+')}`, async () => {
        const i = await input();
        const members = golden.methods.map((method, n) => ({offerId:`offer-${n}`,providerDiscountId:`provider-${n}`,method,code:method==='CODE'?`SAVE${n}`:null,description:`Offer ${n}`,eligibility:{offerId:`offer-${n}`,verdict:'SUPPORTED' as const,eligibleLineKeys:['line-1'],reasonCodes:[]}}));
        i.evaluation.offerDecision={kind:'CHECKOUT_DISCOUNT',offerSet:{schemaVersion:'moda.outreach.checkout-offers.v1',offers:members.map(({offerId,providerDiscountId,method,code})=>({offerId,providerDiscountId,method,code}))},members,group:{verdict:'SUPPORTED',offerIds:members.map(m=>m.offerId),reasonCodes:[]},discoveryIncomplete:false};
        const selected = golden.selected.map(n=>members[n]!);
        const v=i.preparedProjection!.variant, registration=v.metaRegistration!;
        v.purpose=`INITIAL_${golden.presentation}`;
        registration.locale.definition.offerType=golden.presentation;
        const bindings=registration.parameterBindingsSnapshot.body;
        const values=['Test customer','Merchant','2 × Custom label'];
        if(golden.presentation==='CODE_OFFER') {
            bindings.push({position:4,variable:selected.length>1?'offer.codes':'offer.code'});
            values.push(selected.map(m=>m.code).join(', '));
        }
        bindings.push({position:bindings.length+1,variable:'offer.description'});
        values.push(selected.map(m=>m.description).join(', '));
        const body=registration.componentsSnapshot[0]!;
        if(!('text' in body))throw new Error('body');
        body.text=bindings.map(b=>`{{${b.position}}}`).join(' | ');
        rehash(i);
        const original=structuredClone(i.evaluation);
        const r=renderInitialOutreachPreview(i);
        assert.equal(r.kind,'ready');
        if(r.kind==='ready') {
            assert.equal(r.purpose,`INITIAL_${golden.presentation}`);
            assert.equal(r.renderedText,values.join(' | '));
            assert.deepEqual(r.parameters,[{type:'body',parameters:values.map(text=>({type:'text',text}))},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'https%3A%2F%2Fshop.example%2Fcheckout%2F1'}]}]);
        }
        assert.deepEqual(i.evaluation,original);
    });
}

async function brandInput(keys: import('./variables.js').SemanticKey[]) {
    const i = await input(), registration = i.preparedProjection!.variant.metaRegistration!;
    i.variables.shopName = 'Generic merchant';
    const allKeys: import('./variables.js').SemanticKey[] = ['shop.name','checkout.itemsSummary',...keys];
    registration.parameterBindingsSnapshot.body = allKeys.map((variable, n) => ({position:n+1, variable}));
    registration.componentsSnapshot[0] = {type:'BODY',text:allKeys.map((_,n)=>`{{${n+1}}}`).join(' | ')};
    rehash(i);
    return i;
}
const brandKeys = ['shopBrand.brandName','shopBrand.logoAltText','shopBrand.logoWidth','shopBrand.logoHeight','shopBrand.squareLogoAltText'] as const;
const mediaKeys = ['shopBrand.logoUrl','shopBrand.squareLogoUrl','shopBrand.coverImageUrl'] as const;
test('saved brand five-field exact frozen golden preserves parameters/buttons/provenance', async()=>{
    const i=await brandInput([...brandKeys]);i.preparedBrand=preparedBrandFixture();
    const registration=i.preparedProjection!.variant.metaRegistration!;
    const r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind!=='ready')return;
    assert.equal(r.renderedText,'Generic merchant | 2 × Custom label | Saved brand | Saved logo alt | 100 | 200 | Saved square alt');
    assert.deepEqual(r.parameters,[{type:'body',parameters:['Generic merchant','2 × Custom label','Saved brand','Saved logo alt','100','200','Saved square alt'].map(text=>({type:'text',text}))},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'https%3A%2F%2Fshop.example%2Fcheckout%2F1'}]}]);
    assert.deepEqual(r.templateProvenance,{variantId:'variant-1',registrationId:'registration-1',definitionId:'definition-1',providerTemplateId:'provider-template-1',providerTemplateName:'moda_initial_no_offer',providerLanguageCode:'en_US',submittedContentHash:registration.submittedContentHash,bindingFingerprint:registration.submittedContentHash});
    assert.equal(r.headerPreview,null);
});
test('three brand BODY derivatives coexist without header and with different CHECKOUT_PRODUCT header',async()=>{
    const i=await brandInput([...mediaKeys]);i.preparedBrandMedia=preparedBrandMediaFixture();
    const urls=['https://assets.example/logo.webp','https://assets.example/square.webp','https://assets.example/cover.webp'];
    const values=['Generic merchant','2 × Custom label',...urls];
    let r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind!=='ready')return;
    assert.equal(r.renderedText,values.join(' | '));assert.equal(r.headerPreview,null);
    assert.deepEqual(r.parameters[0],{type:'body',parameters:values.map(text=>({type:'text',text}))});
    const reg=i.preparedProjection!.variant.metaRegistration!;reg.componentsSnapshot.unshift({type:'HEADER',format:'IMAGE'});
    reg.parameterBindingsSnapshot.schemaVersion=1;reg.parameterBindingsSnapshot.headerMediaRole='CHECKOUT_PRODUCT';
    i.headerMedia={shopId:'shop-1',role:'CHECKOUT_PRODUCT',status:'READY',kind:'R2_DERIVATIVE',httpsUrl:'https://assets.example/checkout.webp'};rehash(i);
    r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind!=='ready')return;
    assert.equal(r.renderedText,values.join(' | '));assert.deepEqual(r.headerPreview,i.headerMedia);
    assert.deepEqual(r.parameters.slice(0,2),[{type:'header',parameters:[{type:'image',image:{link:'https://assets.example/checkout.webp'}}]},{type:'body',parameters:values.map(text=>({type:'text',text}))}]);
});
test('missing saved brand values never borrow generic name or header; unused missing projections remain compatible',async()=>{
    for(const key of brandKeys){const i=await brandInput([key]);assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'BINDING_VALUE_UNAVAILABLE'});i.preparedBrand=preparedBrandFixture();(i.preparedBrand as any)[key.split('.')[1]!]=null;assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'BINDING_VALUE_UNAVAILABLE'});}
    for(const [key,slot] of mediaKeys.map((key,n)=>[key,['logo','squareLogo','coverImage'][n]!] as const)){
        const i=await brandInput([key]);i.headerMedia={...preparedBrandMediaFixture()[slot as 'logo']!};
        assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'MEDIA_NOT_READY'});
        i.preparedBrandMedia={logo:null,squareLogo:null,coverImage:null};assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'MEDIA_NOT_READY'});
    }
    const i=await input();i.preparedBrand=null;i.preparedBrandMedia=null;assert.equal(renderInitialOutreachPreview(i).kind,'ready');
});
test('saved text/dimension caps and mandatory text refusal use unchanged boundedText rules',async()=>{
    for(const key of ['brandName','logoAltText','squareLogoAltText'] as const){
        const i=await brandInput([`shopBrand.${key}`]);i.preparedBrand=preparedBrandFixture();
        i.preparedBrand[key]='x'.repeat(200);assert.equal(renderInitialOutreachPreview(i).kind,'ready');
        i.preparedBrand[key]='🪴'.repeat(100);assert.equal(renderInitialOutreachPreview(i).kind,'ready');
        i.preparedBrand[key]='x'.repeat(201);assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'INVALID_REQUEST'});
        for(const text of ['','   ','bad\u0000','bad\n','{{value}}','bad}}','\ud800']){i.preparedBrand[key]=text;assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'BINDING_VALUE_UNAVAILABLE'});}
        i.preparedBrand[key]='  Saved text  ';const r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind==='ready')assert.equal(r.renderedText,'Generic merchant | 2 × Custom label | Saved text');
    }
    for(const key of ['logoWidth','logoHeight'] as const){
        const i=await brandInput([`shopBrand.${key}`]);i.preparedBrand=preparedBrandFixture();
        for(const value of [1,10000]){i.preparedBrand[key]=value;const r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind==='ready')assert.equal(r.renderedText,'Generic merchant | 2 × Custom label | '+String(value));}
        for(const value of [0,-1,10001,1.5,NaN,Infinity,'100']){(i.preparedBrand as any)[key]=value;assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'INVALID_REQUEST'});}
    }
});
test('prepared tenant/role/URL validation precedes assignment and applies to unused fields',async()=>{
    const i=await input();i.preparedBrand=preparedBrandFixture();i.preparedBrand.shopId='foreign';i.preparedProjection=null;
    assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'IDENTITY_MISMATCH'});
    for(const patch of [{shopId:'foreign'},{role:'COVER_IMAGE'},{httpsUrl:'https://assets.example/logo.webp#fragment'},{httpsUrl:'https://assets.example/logo.webp#'},{httpsUrl:'https://localhost/logo.webp'}]){
        const j=await input();j.preparedBrandMedia=preparedBrandMediaFixture();Object.assign(j.preparedBrandMedia.logo!,patch);j.preparedProjection=null;
        assert.deepEqual(renderInitialOutreachPreview(j),{kind:'refused',reasonCode:'MEDIA_NOT_READY'});
    }
    const j=await input();j.preparedBrandMedia=preparedBrandMediaFixture();
    for(const patch of [{httpsUrl:'not a URL'},{httpsUrl:'http://assets.example/logo.webp'},{httpsUrl:'https://user:secret@assets.example/logo.webp'},{httpsUrl:'https://assets.example/'+ 'x'.repeat(2048)},{status:'PENDING'},{kind:'ORIGINAL'},{extra:true}]){
        const bad=structuredClone(j);Object.assign(bad.preparedBrandMedia!.logo!,patch);
        assert.doesNotThrow(()=>renderInitialOutreachPreview(bad));assert.deepEqual(renderInitialOutreachPreview(bad),{kind:'refused',reasonCode:'INVALID_REQUEST'});
    }
    const malformed=await input();malformed.variables.checkoutUrl='not a URL';assert.doesNotThrow(()=>renderInitialOutreachPreview(malformed));assert.deepEqual(renderInitialOutreachPreview(malformed),{kind:'refused',reasonCode:'INVALID_REQUEST'});
});
test('brand BODY media retains exact validated URL bytes rather than boundedText trimming',async()=>{
    const i=await brandInput(['shopBrand.logoUrl']);i.preparedBrandMedia=preparedBrandMediaFixture();
    const url=' https://assets.example/logo.webp ';i.preparedBrandMedia.logo!.httpsUrl=url;
    const parsed=InitialOutreachRenderInputSchema.safeParse(i);
    if(parsed.success){const validatedUrl=parsed.data.preparedBrandMedia!.logo!.httpsUrl;const r=renderInitialOutreachPreview(i);assert.equal(r.kind,'ready');if(r.kind==='ready'){assert.equal(r.renderedText,'Generic merchant | 2 × Custom label | '+validatedUrl);assert.deepEqual(r.parameters[0],{type:'body',parameters:['Generic merchant','2 × Custom label',validatedUrl].map(text=>({type:'text',text}))});}}
    else assert.deepEqual(renderInitialOutreachPreview(i),{kind:'refused',reasonCode:'INVALID_REQUEST'});
});
