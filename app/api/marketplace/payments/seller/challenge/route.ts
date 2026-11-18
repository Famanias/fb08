import { handleSellerChallenge } from '@/lib/server/marketplace-payments/seller-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleSellerChallenge(req);
