import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimalToMinor, applicationFeeMinor, paymentEligible } from './rules';

test('PHP fee uses exact minor units and half-up rounding', () => {
  assert.equal(decimalToMinor('1234.50'), 123450);
  assert.equal(applicationFeeMinor(123450), 12345);
  assert.equal(applicationFeeMinor(10005), 1001);
  assert.throws(() => decimalToMinor('1e3'));
  assert.throws(() => decimalToMinor('0.001'));
});
test('money rejects malformed, negative and unsafe amounts', () => {
  for (const value of ['-1', '+1', '.50', '1.', ' 1', 'NaN', '900719925474099.99']) assert.throws(() => decimalToMinor(value));
  for (const value of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => applicationFeeMinor(value));
});
test('payment eligibility is independent of listing validation bounds', () => {
  for (const value of [10000, 99999999]) assert.equal(paymentEligible(value), true);
  for (const value of [0, 9999, 100000000, NaN, 10000.1]) assert.equal(paymentEligible(value), false);
});
