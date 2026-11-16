export async function marketplaceRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error('The connection was interrupted. Your details are still here; please try again.'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || (response.status === 413 ? 'The photo is too large. Choose one under 3 MiB.' : 'Could not save this submission. Please try again.'));
  return body as T;
}
