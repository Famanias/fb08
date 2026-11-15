import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseEnvInput {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export type SupabaseConfigResult =
  | { ok: true; url: string; key: string }
  | { ok: false; error: string };

function isServiceRoleJwt(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { role?: unknown };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export function resolveSupabaseConfig(
  env: SupabaseEnvInput = {
    // Static property access is required for Next.js client bundle env inlining.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
): SupabaseConfigResult {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const rawKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    '';

  if (!rawUrl || !rawKey) {
    return {
      ok: false,
      error:
        'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).',
    };
  }

  if (!/^https?:\/\/.+/i.test(rawUrl)) {
    return {
      ok: false,
      error: 'Invalid NEXT_PUBLIC_SUPABASE_URL. Expected an http(s) URL.',
    };
  }

  if (rawKey.startsWith('sb_secret_') || isServiceRoleJwt(rawKey)) {
    return {
      ok: false,
      error:
        'Refusing to run with a secret or service_role Supabase key in browser code. Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or the public anon key.',
    };
  }

  return {
    ok: true,
    url: rawUrl.replace(/\/+$/, ''),
    key: rawKey,
  };
}

let cachedBrowserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): {
  client: SupabaseClient | null;
  error?: string;
} {
  const config = resolveSupabaseConfig();
  if (!config.ok) {
    return { client: null, error: config.error };
  }
  if (!cachedBrowserClient) {
    cachedBrowserClient = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }
  return { client: cachedBrowserClient };
}
