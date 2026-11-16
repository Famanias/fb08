import { handleInquiry } from '@/lib/server/marketplace-handlers';
export const runtime = 'nodejs';
export async function POST(request: Request) { return handleInquiry(request); }
