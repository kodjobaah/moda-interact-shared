import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commerceStoreHostname, productBelongsToDomain } from './schemas';
import type { z } from 'zod';
import type { CommerceProductSchema } from './schemas';
test('verified shop identities accept Shopify hosts and Woo HTTPS origins', () => {
  for (const identity of ['shop.example', 'https://shop.example', 'https://SHOP.example/']) {
    assert.equal(commerceStoreHostname(identity), 'shop.example');
    assert.equal(productBelongsToDomain({ url: 'https://shop.example/product/18' } as z.infer<typeof CommerceProductSchema>, identity), true);
    assert.equal(productBelongsToDomain({ url: 'https://other.example/product/18' } as z.infer<typeof CommerceProductSchema>, identity), false);
  }
});
test('shop identities cannot smuggle paths, credentials or insecure origins', () => {
  for (const identity of ['http://shop.example', 'https://user@shop.example', 'https://shop.example/path', 'https://shop.example?x=1', 'https://shop.example#x', 'https://shop.example:8443', 'shop.example\\evil', ' shop.example']) assert.equal(commerceStoreHostname(identity), null);
});
