/** Decimal text is converted without floating point arithmetic. */
export function decimalToMinor(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe monetary amount');
  return Number(minor);
}
export function applicationFeeMinor(gross: number): number {
  if (!Number.isSafeInteger(gross) || gross < 0) throw new Error('Invalid monetary amount');
  return Number((BigInt(gross) + BigInt(5)) / BigInt(10));
}
export function paymentEligible(gross: number): boolean {
  return Number.isSafeInteger(gross) && gross >= 10000 && gross <= 99999999;
}
