import { handleDeleteProfileComment } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function DELETE(
  req: Request,
  context: { params: Promise<{ commentId: string }> }
) {
  const { commentId } = await context.params;
  return withRouteError(() => handleDeleteProfileComment(req, commentId));
}
