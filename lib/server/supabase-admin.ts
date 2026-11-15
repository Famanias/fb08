import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedAdminClient: SupabaseClient | null = null;

/** Server-only Supabase admin client using service_role; never import from browser code. */
export function getSupabaseAdminClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

  if (!url || !/^https?:\/\/.+/i.test(url)) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing or invalid.');
  }
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is missing. Set it in server environment variables.'
    );
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return cachedAdminClient;
}
