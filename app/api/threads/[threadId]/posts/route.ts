import { handleCreateReply } from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  return withRouteError(() => handleCreateReply(req, threadId));
}
