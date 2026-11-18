import { handleCheckout } from '@/lib/server/marketplace-payments/checkout-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleCheckout(req);
