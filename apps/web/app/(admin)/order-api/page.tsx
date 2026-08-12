import { redirect } from "next/navigation";
import { withAccount } from "@/lib/db";
import { getCurrentSite } from "@/lib/current-site";
import { getSession } from "@/lib/session";
import { OrderApiForm } from "./order-api-form";

export default async function OrderApiPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const site = await withAccount(session.accountId, (client) => getCurrentSite(client));
  if (!site) redirect("/campaigns");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>受注API連携</h1>
      <p style={{ color: "#666", fontSize: 13 }}>
        商品コード・金額はサンクスページのタグから即時取得できるため、この連携をしなくてもツールは問題なく動作します。
        初回/継続の区別だけを正確にしたい場合に使う任意機能です。
      </p>
      <OrderApiForm siteId={site.id} />
    </div>
  );
}
