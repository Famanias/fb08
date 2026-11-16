import { handleUpdateAvatar } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function PATCH(req: Request) {
  return withRouteError(() => handleUpdateAvatar(req));
}
