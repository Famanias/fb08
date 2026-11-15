import {
  handleDeleteThread,
  handleGetThreadDetail,
} from '@/lib/server/board-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  return withRouteError(() => handleGetThreadDetail(req, threadId));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await context.params;
  return withRouteError(() => handleDeleteThread(req, threadId));
}
