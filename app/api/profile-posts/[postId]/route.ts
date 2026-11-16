import {
  handleDeleteProfilePost,
  handleUpdateProfilePost,
} from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  return withRouteError(() => handleUpdateProfilePost(req, postId));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  return withRouteError(() => handleDeleteProfilePost(req, postId));
}
