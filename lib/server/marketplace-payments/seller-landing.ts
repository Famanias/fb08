import { cookies } from 'next/headers';
import { handleSellerStatus } from './seller-handlers';
// Both hosted landings require the existing browser seller proof. No query parameter grants authority.
export async function sellerLandingStatus(): Promise<{ verified: boolean; connection: string }> {
  const cookieStore = await cookies();
  const response = await handleSellerStatus(new Request('http://internal.invalid/marketplace/payments', { headers: { cookie: cookieStore.toString() } }));
  if (!response.ok) return { verified: false, connection: 'not_connected' };
  const value = await response.json(); return { verified: value.verified === true, connection: String(value.connection) };
}
