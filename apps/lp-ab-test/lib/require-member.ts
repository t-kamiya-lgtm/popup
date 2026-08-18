import { NextResponse } from "next/server";
import { pool } from "./db";
import { createSupabaseServerClient } from "./supabase/server";

export type Role = "admin" | "editor" | "viewer";

export interface Member {
  id: number;
  email: string;
  role: Role;
}

/** docs/lp-ab-test/00-requirements.md 8 — the permission matrix. */
export function canManageMembers(role: Role): boolean {
  return role === "admin";
}
export function canEditLps(role: Role): boolean {
  return role === "admin" || role === "editor";
}

/**
 * Resolves the logged-in Supabase Auth user to this app's `members` row.
 * Returns null if there's no session, or the session's user has no
 * corresponding (accepted) invite — both cases are treated identically by
 * callers ("not logged in, as far as this app is concerned").
 */
export async function getCurrentMember(): Promise<Member | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { rows } = await pool().query(
    `SELECT id, email, role FROM members WHERE auth_user_id = $1 AND accepted_at IS NOT NULL`,
    [user.id]
  );
  if (rows.length === 0) return null;
  return { id: Number(rows[0].id), email: rows[0].email as string, role: rows[0].role as Role };
}

/**
 * For API route handlers:
 *   const member = await requireMember();
 *   if (member instanceof NextResponse) return member;
 */
export async function requireMember(): Promise<Member | NextResponse> {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return member;
}

export async function requireEditor(): Promise<Member | NextResponse> {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;
  if (!canEditLps(member.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return member;
}

export async function requireAdmin(): Promise<Member | NextResponse> {
  const member = await requireMember();
  if (member instanceof NextResponse) return member;
  if (!canManageMembers(member.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return member;
}
