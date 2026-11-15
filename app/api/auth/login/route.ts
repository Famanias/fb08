import { handleLogin } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withRouteError(() => handleLogin(req));
}
