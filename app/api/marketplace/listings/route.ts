import { handleBrowse, handleCreate } from '@/lib/server/marketplace-handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleBrowse(request); }
export async function POST(request: Request) { return handleCreate(request); }
