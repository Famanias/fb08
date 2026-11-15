import { SESSION_COOKIE_NAME, verifySessionToken } from './auth';
import { BoardServerStore } from './board-store';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function parseJsonBody<T extends Record<string, unknown>>(
  req: Request
): Promise<T | null> {
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function readCookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      return part.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

export async function getAuthenticatedUser(
  req: Request,
  store: BoardServerStore,
  secretOverride?: string
): Promise<{ id: string; username: string } | null> {
  const token = readCookieValue(req, SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }
  const verified = verifySessionToken(token, secretOverride);
  if (!verified) {
    return null;
  }
  return store.findUserById(verified.userId);
}

export async function withRouteError(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err: unknown) {
    console.error('[board-api]', err);
    return jsonResponse(
      {
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Internal server error.',
      },
      500
    );
  }
}
