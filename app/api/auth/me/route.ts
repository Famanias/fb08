import { handleGetMe } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withRouteError(() => handleGetMe(req));
}
