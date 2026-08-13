import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          borderBottom: "1px solid #ddd",
        }}
      >
        <nav style={{ display: "flex", gap: 16 }}>
          <a href="/campaigns">キャンペーン</a>
          <a href="/reports">実績レポート</a>
          <a href="/order-api">受注API連携</a>
          <a href="/members">メンバー管理</a>
        </nav>
        <LogoutButton />
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
