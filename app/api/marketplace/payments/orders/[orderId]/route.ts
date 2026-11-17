import { handleOrderStatus } from '@/lib/server/marketplace-payments/order-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) { return handleOrderStatus(req); }
