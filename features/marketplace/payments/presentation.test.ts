import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentLabel, orderHeading, sellerConnectionCopy, listingAvailabilityLabel, SANDBOX_NOTICE, feeCopy } from './presentation';
test('payment labels keep sandbox, demo, held and sold distinct', () => {
  assert.equal(paymentLabel({ sandbox: true, availability: 'ready' }), 'Buy Now');
  assert.match(paymentLabel({ sandbox: true, availability: 'reserved' }), /held/i);
  assert.match(paymentLabel({ sandbox: true, availability: 'unavailable' }), /unavailable/i);
  assert.equal(paymentLabel({ sandbox: true, availability: 'sold' }), 'Sold');
  assert.equal(listingAvailabilityLabel('sold'), 'Sold');
  assert.equal(listingAvailabilityLabel('active'), 'Available');
  assert.match(SANDBOX_NOTICE, /no real money or delivery/); assert.match(feeCopy, /processing fees/);
});
test('only persisted paid displays confirmation, including after polling timeout', () => {
  assert.equal(orderHeading('pending'), 'Payment confirmation pending'); assert.equal(orderHeading('paid'), 'Sandbox payment confirmed');
  assert.match(orderHeading('review'), /review/i); assert.match(orderHeading('expired'), /expired/i);
  assert.match(sellerConnectionCopy('pending'), /not ready/i); assert.match(sellerConnectionCopy('restricted'), /unavailable/i);
});
