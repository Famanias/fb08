import { handleFollowToggle } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  const { username } = await context.params;
  return withRouteError(() => handleFollowToggle(req, username, true));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  const { username } = await context.params;
  return withRouteError(() => handleFollowToggle(req, username, false));
}
