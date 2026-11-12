import { providerObservationHash } from './provider-observation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRecoveryAssignment} from './selection.js';
import {evaluateInitialOutreach} from './evaluate.js';
import {fixture,ports,renderFixture} from './test-fixtures.js';
async function setup(){const evaluation=await evaluateInitialOutreach(fixture(),ports().value);if(evaluation.kind!=='ready')throw new Error('fixture');const v=renderFixture(evaluation).preparedProjection!.variant;return {shop:{id:'shop-1',status:'ACTIVE',defaultLanguageTag:'en'},shopId:'shop-1',senderWabaId:'waba-1',purpose:'INITIAL_NO_OFFER',variants:[v],stage:'INITIAL' as const,promotionTarget:'CHECKOUT' as const,offer:'NO_OFFER' as const,conversationLanguageTag:'en-GB',merchantLanguageTag:'en',platformFallbackEnabled:false,platformFallbackLanguageTag:null,headerFormat:'TEXT' as const,logger:{warn(){}}};}
test('ported assignment selection uses language base before merchant fallback and rejects ambiguity',async()=>{const i=await setup();let r=selectRecoveryAssignment(i);assert.equal(r.outcome,'selected');if(r.outcome==='selected'){assert.equal(r.value.selectionSource,'base');assert.equal(r.value.canonicalLanguageTag,'en');}i.variants.push(structuredClone(i.variants[0]!));r=selectRecoveryAssignment(i);assert.equal(r.outcome==='unavailable'&&r.reason,'AMBIGUOUS_ASSIGNMENT');});
test('ported assignment selection rejects broken required summary slot and foreign WABA',async()=>{let i=await setup();i.variants[0]!.metaRegistration!.parameterBindingsSnapshot.body[2]!.position=8;let r=selectRecoveryAssignment(i);assert.equal(r.outcome==='unavailable'&&r.reason,'BINDINGS_INVALID');i=await setup();i.senderWabaId='foreign';r=selectRecoveryAssignment(i);assert.equal(r.outcome==='unavailable'&&r.reason,'IDENTITY_MISMATCH');});

test('brand logo assignment is eligible without a checkout product image', async () => {
    const input = await setup();
    const registration = input.variants[0]!.metaRegistration!;
    registration.componentsSnapshot.unshift({type: 'HEADER', format: 'IMAGE'});
    const bindings = registration.parameterBindingsSnapshot;
    bindings.headerMediaRole = 'LOGO';
    bindings.schemaVersion = 1;
    registration.lastObservedContentHash = providerObservationHash(registration.componentsSnapshot)!;
    const query = {...input, headerFormat: 'IMAGE' as const, checkoutProductHeaderAvailable: false};
    assert.equal(selectRecoveryAssignment(query).outcome, 'selected');
    bindings.headerMediaRole = 'CHECKOUT_PRODUCT';
    assert.equal(selectRecoveryAssignment(query).outcome, 'unavailable');
});

test('greeting selection uses a name only when present and preserves neutral-only assignments', async () => {
    const input = await setup();
    const neutral = input.variants[0]!;
    const named = structuredClone(neutral);
    named.id = 'personalized';
    const bindings = neutral.metaRegistration!.parameterBindingsSnapshot;
    bindings.body = bindings.body.filter(binding => binding.variable !== 'customer.firstName')
        .map((binding, index) => ({...binding, position: index + 1}));
    input.variants.push(named);
    const choose = (hasCustomerFirstName: boolean) => {
        const result = selectRecoveryAssignment({...input, hasCustomerFirstName});
        return result.outcome === 'selected' ? result.value.variant.id : result.reason;
    };
    assert.equal(choose(false), neutral.id);
    assert.equal(choose(true), named.id);
    input.variants.pop();
    assert.equal(choose(true), neutral.id);
});

test('provider observations compare rendered components rather than the immutable authoring digest', async () => {
    const input = await setup();
    const registration = input.variants[0]!.metaRegistration!;
    assert.notEqual(registration.lastObservedContentHash, registration.submittedContentHash);
    assert.equal(selectRecoveryAssignment(input).outcome, 'selected');
    const body = registration.componentsSnapshot.find(component => component.type === 'BODY')!;
    if (body.type !== 'BODY') throw new Error('fixture body');
    body.example = {body_text: [['Different submission-only sample']]};
    assert.equal(selectRecoveryAssignment(input).outcome, 'selected');
    body.text += ' Changed provider text';
    assert.deepEqual(selectRecoveryAssignment(input), {outcome: 'unavailable', reason: 'PROVIDER_DRIFT'});
});

for (const drift of ['observed-category', 'drift-marker', 'provider-identity'] as const) {
    test(`approved assignments still reject ${drift}`, async () => {
        const input = await setup();
        const registration = input.variants[0]!.metaRegistration!;
        if (drift === 'observed-category') registration.lastObservedCategory = 'UTILITY';
        if (drift === 'drift-marker') registration.driftDetectedAt = new Date().toISOString();
        if (drift === 'provider-identity') registration.providerTemplateId = 'different-provider-id';
        assert.deepEqual(selectRecoveryAssignment(input), {outcome: 'unavailable',
            reason: drift === 'provider-identity' ? 'IDENTITY_MISMATCH' : 'PROVIDER_DRIFT'});
    });
}
