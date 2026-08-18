import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Server Component / Route Handler Supabase client, backed by the request's
 * cookies. Used only for Auth (session lookup, OAuth code exchange) — all
 * data access goes through lib/db.ts's `pg` pool, not this client
 * (docs/lp-ab-test/01-data-model.md: no RLS, so PostgREST buys us nothing
 * here beyond what a plain SQL query already does).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component render (not a Route Handler /
            // Server Action) — cookies() is read-only there. Session refresh
            // will still happen on the next request that hits a route
            // handler, so this is safe to ignore.
          }
        },
      },
    }
  );
}
