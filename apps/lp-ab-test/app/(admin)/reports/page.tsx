import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";
import { ReportsPanel } from "./reports-panel";

export default async function ReportsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>レポート</h1>
      <ReportsPanel />
    </div>
  );
}
