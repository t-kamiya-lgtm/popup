import { redirect } from "next/navigation";
import { withAccount } from "@/lib/db";
import { getCurrentSite } from "@/lib/current-site";
import { getSession } from "@/lib/session";
import { TagsPanel } from "./tags-panel";

export default async function TagsPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const site = await withAccount(session.accountId, (client) => getCurrentSite(client));
  if (!site) redirect("/campaigns");

  const cdnBase = (process.env.NEXT_PUBLIC_CDN_BASE_URL ?? "").replace(/\/$/, "");

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 20 }}>タグ管理</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        商品ページ・LP・サンクスページに設置するタグです。設置後は各ページの表示に影響しないか確認してください
        （`docs/05-tag-sdk.md` 1章）。
      </p>
      <TagsPanel sitePublicId={site.publicId} cdnBase={cdnBase} />
    </div>
  );
}
