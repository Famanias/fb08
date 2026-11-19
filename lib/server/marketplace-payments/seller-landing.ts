import { cookies } from 'next/headers';
import type { SellerPaymentStatus } from '../../../features/marketplace/payments/types';
import { handleSellerStatus } from './seller-handlers';
// Stripe redirects use the fb/08 session from the returning browser.
export async function sellerLandingStatus(): Promise<SellerPaymentStatus | undefined> {
  const cookieStore = await cookies();
  const response = await handleSellerStatus(new Request('http://internal.invalid/marketplace/payments', { headers: { cookie: cookieStore.toString() } }));
  if (response.ok) return response.json();
}
