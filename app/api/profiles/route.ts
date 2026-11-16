import { handleListProfiles } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withRouteError(() => handleListProfiles(req));
}
