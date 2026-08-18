import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<string, string> = { admin: "管理者", editor: "編集者", viewer: "閲覧者" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          borderBottom: "1px solid #ddd",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <strong style={{ fontSize: 16 }}>LPクリエイティブABテストツール</strong>
          <nav style={{ display: "flex", gap: 16 }}>
            <a href="/lps">LP一覧</a>
            <a href="/reports">レポート</a>
            {member.role === "admin" && <a href="/members">メンバー管理</a>}
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#666" }}>
          <span>
            {member.email}（{ROLE_LABEL[member.role]}）
          </span>
          <LogoutButton />
        </div>
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
