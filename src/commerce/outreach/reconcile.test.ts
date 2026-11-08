import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fingerprintInitialOutreachBasket} from './reconcile.js';
import {fixture} from './test-fixtures.js';
test('price basket canonical digest golden retains ordered duplicate content and excludes host admission identity',()=>{
 const i=fixture();const expected=createHash('sha256').update('ARCH052_PRICE_BASKET_V1\0'+JSON.stringify({currency:'USD',lineItems:[{productId:'gid://shopify/Product/1',variantId:null,title:null,variantTitle:null,sku:null,quantity:2,price:'10.00'}]}),'utf8').digest('hex');assert.equal(fingerprintInitialOutreachBasket(i),expected);
 i.checkout.lines.push({...i.checkout.lines[0]!,lineKey:'second',quantity:3});const before=fingerprintInitialOutreachBasket(i);i.checkout.lines.reverse();assert.notEqual(fingerprintInitialOutreachBasket(i),before);i.checkout.lines[0]!.quantity++;assert.notEqual(fingerprintInitialOutreachBasket(i),before);
});
