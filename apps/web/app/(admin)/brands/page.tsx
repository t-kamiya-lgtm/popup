import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { BrandsPanel } from "./brands-panel";

export default async function BrandsPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>ブランド管理</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        キャンペーンに設定するブランドを管理します。実績レポートはブランド単位で集計されます。
      </p>
      <BrandsPanel />
    </div>
  );
}
