import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";
import { LpsPanel } from "./lps-panel";

export default async function LpsPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>LP一覧</h1>
      <LpsPanel canEdit={member.role === "admin" || member.role === "editor"} />
    </div>
  );
}
