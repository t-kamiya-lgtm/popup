import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: number;
  accountId?: number;
}

// Built lazily (not at module scope) for the same reason as lib/db.ts's
// Pool getters: Next.js evaluates route modules during `next build`'s
// page-data collection, before env vars are guaranteed to be present.
function sessionOptions() {
  return {
    password: requireEnv("SESSION_SECRET"),
    cookieName: "pz_admin_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
