import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/require-member";
import { MembersPanel } from "./members-panel";

export default async function MembersPage() {
  const member = await getCurrentMember();
  if (!member) redirect("/login");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>メンバー管理</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        招待制です。ここでメールアドレスを招待すると、そのアドレスの
        {process.env.ALLOWED_EMAIL_DOMAIN ? ` @${process.env.ALLOWED_EMAIL_DOMAIN} ` : " "}
        Googleアカウントでログインした時点で有効になります。
      </p>
      <MembersPanel isAdmin={member.role === "admin"} />
    </div>
  );
}
