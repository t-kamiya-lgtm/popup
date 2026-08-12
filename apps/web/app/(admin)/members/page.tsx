import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { MembersPanel } from "./members-panel";

export default async function MembersPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>メンバー管理</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        招待制です。ここでメールアドレスを招待すると、そのアドレスでGoogleログインした時点でアカウントが有効になります。
      </p>
      <MembersPanel accountId={session.accountId} />
    </div>
  );
}
