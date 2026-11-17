import { handleConnect } from '@/lib/server/marketplace-payments/connect-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (req: Request) => handleConnect(req);
