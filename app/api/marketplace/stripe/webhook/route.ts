import { handleStripeWebhook } from '@/lib/server/marketplace-payments/webhook-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleStripeWebhook(req);
