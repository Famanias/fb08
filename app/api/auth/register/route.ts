import { handleRegister } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withRouteError(() => handleRegister(req));
}
