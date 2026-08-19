import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client — only used to kick off the Google OAuth
 * redirect (app/login). `NEXT_PUBLIC_*` vars must be referenced with a
 * literal `process.env.NEXT_PUBLIC_X` expression for Next.js's build-time
 * inlining to pick them up — `process.env[name]` with a dynamic key (as a
 * shared `requireEnv(name)` helper would need) isn't statically analyzable,
 * so it silently evaluates against an empty object in the browser bundle.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  }
  return createBrowserClient(url, anonKey);
}
