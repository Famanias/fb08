import { handleCreateUploadUrl } from '@/lib/server/profile-handlers';
import { withRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return withRouteError(() => handleCreateUploadUrl(req));
}
