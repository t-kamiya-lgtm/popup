import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getSession } from "@/lib/session";

async function requireOwner(client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }, userId: number) {
  const { rows } = await client.query(`SELECT role FROM memberships WHERE user_id = $1 AND accepted_at IS NOT NULL`, [
    userId,
  ]);
  return (rows as { role: string }[]).some((r) => r.role === "owner");
}

/** GET /api/v1/accounts/{id}/members — docs/04-api.md 2. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const { id } = await params;
  if (Number(id) !== accountId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return withAccount(accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT m.role, m.accepted_at, m.created_at, u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.account_id = $1 ORDER BY m.created_at ASC`,
      [accountId]
    );
    return NextResponse.json({
      members: rows.map((r) => ({
        email: r.email,
        role: r.role,
        status: r.accepted_at ? "active" : "invited",
        invitedAt: r.created_at,
      })),
    });
  });
}

/**
 * POST /api/v1/accounts/{id}/members — invite a member by email (docs/04-api.md 2).
 * No self-service signup exists anywhere in this app; this is the only way
 * a new login is ever created. Creates the `users` row if needed and a
 * `memberships` row with `accepted_at = NULL` — the invite is accepted
 * automatically the first time that email successfully signs in with
 * Google (app/api/v1/auth/google/callback).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;
  const { id } = await params;
  if (Number(id) !== accountId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;
  if (!email || !["owner", "editor", "viewer"].includes(role)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  return withAccount(accountId, async (client) => {
    if (!(await requireOwner(client, session.userId!))) {
      return NextResponse.json({ error: "招待できるのはオーナー権限のメンバーのみです" }, { status: 403 });
    }

    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email]
    );

    const { rowCount } = await client.query(
      `INSERT INTO memberships (account_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, user_id) DO NOTHING`,
      [accountId, user.id, role]
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: "既に招待済みです" }, { status: 409 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
