import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { OrderConfirmation } from '@/features/marketplace/components/OrderConfirmation';
import { handleOrderStatus } from '@/lib/server/marketplace-payments/order-handlers';
import { validUuid } from '@/features/marketplace/validation';
export const dynamic = 'force-dynamic';
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params; if (!validUuid(orderId)) notFound();
  const cookieStore = await cookies();
  const response = await handleOrderStatus(new Request(`http://internal.invalid/api/marketplace/payments/orders/${orderId}`, { headers: { cookie: cookieStore.toString() } }));
  if (response.status === 404) notFound();
  if (!response.ok) return <div className="error-box" role="alert">Could not read order status. Please refresh.</div>;
  return <OrderConfirmation initial={await response.json()} />;
}
