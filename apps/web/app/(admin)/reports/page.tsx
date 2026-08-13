import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ReportsPanel } from "./reports-panel";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  return (
    <div>
      <h1 style={{ fontSize: 20 }}>実績レポート</h1>
      <ReportsPanel />
    </div>
  );
}
