import { redirect } from "next/navigation";
import { withAccount } from "@/lib/db";
import { getSession } from "@/lib/session";
import { MembersPanel } from "./members-panel";

export default async function MembersPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  // Drives whether the delete/cancel button renders at all — the API
  // enforces the same owner-only check independently, this is just so a
  // non-owner doesn't see a button that will 403 anyway.
  const isOwner = await withAccount(session.accountId, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM memberships WHERE account_id = $1 AND user_id = $2 AND accepted_at IS NOT NULL AND role = 'owner'`,
      [session.accountId, session.userId]
    );
    return rows.length > 0;
  });

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>メンバー管理</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        招待制です。ここでメールアドレスを招待すると、そのアドレスでGoogleログインした時点でアカウントが有効になります。
      </p>
      <MembersPanel accountId={session.accountId} isOwner={isOwner} />
    </div>
  );
}
