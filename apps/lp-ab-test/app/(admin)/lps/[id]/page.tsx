import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";
import { pool } from "@/lib/db";
import { LpDetailPanel } from "./lp-detail-panel";

export default async function LpDetailPage({ params }: { params: { id: string } }) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  const lpId = Number(params.id);
  const { rows } = await pool().query(`SELECT lp_name FROM lps WHERE id = $1`, [lpId]);
  if (rows.length === 0) redirect("/lps");

  return (
    <div>
      <p style={{ marginBottom: 8 }}>
        <a href="/lps">← LP一覧</a>
      </p>
      <LpDetailPanel lpId={lpId} canEdit={member.role === "admin" || member.role === "editor"} />
    </div>
  );
}
