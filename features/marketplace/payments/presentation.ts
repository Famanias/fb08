import type { OrderConfirmation, PublicPaymentState } from './types';
export const SANDBOX_NOTICE = 'Sandbox demo — no real money or delivery';
export const feeCopy = 'The platform fee is 10%. The seller amount shown is before Stripe processing fees and other fees; no real payout is made.';
export function listingAvailabilityLabel(status: 'active' | 'sold'): string { return status === 'sold' ? 'Sold' : 'Available'; }
export function paymentLabel(state: PublicPaymentState): string {
  return { ready: 'Buy Now', reserved: 'Item held — payment in progress', sold: 'Sold', unavailable: 'Online payment unavailable' }[state.availability];
}
export function orderHeading(status: OrderConfirmation['status']): string {
  return { pending: 'Payment confirmation pending', paid: 'Sandbox payment confirmed', expired: 'Payment session expired', review: 'Payment needs review' }[status];
}
export function sellerConnectionCopy(connection: string): string {
  return { ready: 'Ready for sandbox payments. Checkout rechecks availability before payment.', pending: 'Onboarding is incomplete or still pending. Payments are not ready.', restricted: 'Payments are unavailable. Review the requirements in Stripe onboarding.', not_connected: 'Connect with Stripe to start sandbox onboarding.' }[connection] ?? 'Payment status is unavailable. Try checking again.';
}
