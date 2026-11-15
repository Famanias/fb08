import { handleDeleteReply, handleEditPost } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  return withRouteError(() => handleEditPost(req, postId));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  return withRouteError(() => handleDeleteReply(req, postId));
}
