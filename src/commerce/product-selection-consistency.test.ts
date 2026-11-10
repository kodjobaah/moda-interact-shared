import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommerceProductSelections,commerceProductSelectionConflict } from './selection';
const pair={productId:'28',variantId:null};
test('unused empty selection slots normalize without changing text or actual selected products',()=>{
 const details={productDetailSelections:[pair],productRecommendations:[],productRecommendationVersion:'1',productOptionSelections:[]};
 assert.deepEqual(normalizeCommerceProductSelections(details),{productDetailSelections:[pair]});
 assert.equal(details.productRecommendationVersion,'1');
 assert.equal(commerceProductSelectionConflict(normalizeCommerceProductSelections(details)),null);
});
test('non-empty selection conflicts retain a deterministic exact reason',()=>{
 assert.equal(commerceProductSelectionConflict({productDetailSelections:[pair],productRecommendations:[pair]}),'RECOMMENDATION_FACT_SELECTION_CONFLICT');
 assert.equal(commerceProductSelectionConflict({productDetailSelections:[pair],productOptionSelections:[pair]}),'DETAIL_OPTION_SELECTION_CONFLICT');
 assert.equal(commerceProductSelectionConflict({productDetailSelections:[pair],shippingInformationSelection:pair}),null);
});

import {planCommerceVerificationBudget} from './selection';
test('verification reservation is bounded and uses the same allocation in all hosts',()=>{
 assert.deepEqual(planCommerceVerificationBudget(8),{totalCalls:8,discoveryCalls:4,verificationCalls:4});
 assert.deepEqual(planCommerceVerificationBudget(10),{totalCalls:10,discoveryCalls:6,verificationCalls:4});
 assert.deepEqual(planCommerceVerificationBudget(3),{totalCalls:3,discoveryCalls:1,verificationCalls:2});
 assert.deepEqual(planCommerceVerificationBudget(8,false),{totalCalls:8,discoveryCalls:8,verificationCalls:0});
 assert.throws(()=>planCommerceVerificationBudget(0));
});
