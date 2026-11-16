import { handleGetProfile } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  const { username } = await context.params;
  return withRouteError(() => handleGetProfile(req, username));
}
