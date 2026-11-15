import { handleLogout } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST() {
  return withRouteError(() => handleLogout());
}
