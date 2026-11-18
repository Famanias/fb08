import { handleSellerStatus } from '@/lib/server/marketplace-payments/seller-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => handleSellerStatus(req);
