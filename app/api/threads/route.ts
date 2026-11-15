import { handleCreateThread, handleListThreads } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withRouteError(() => handleListThreads(req));
}

export async function POST(req: Request) {
  return withRouteError(() => handleCreateThread(req));
}
