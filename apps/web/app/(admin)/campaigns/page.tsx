import { redirect } from "next/navigation";
import { getCurrentSite } from "@/lib/current-site";
import { withAccount } from "@/lib/db";
import { getSession } from "@/lib/session";
import { NewCampaignButton } from "./new-campaign-button";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  active: "配信中",
  paused: "停止",
  archived: "アーカイブ",
};

export default async function CampaignsPage() {
  const session = await getSession();
  if (!session.accountId) redirect("/login");

  const { site, campaigns } = await withAccount(session.accountId, async (client) => {
    const site = await getCurrentSite(client);
    if (!site) return { site: null, campaigns: [] };
    const { rows } = await client.query(
      `SELECT c.id, c.name, c.status, c.priority, c.holdout_rate,
              (SELECT count(*) FROM creatives cr WHERE cr.campaign_id = c.id) AS creative_count
       FROM campaigns c WHERE c.site_id = $1 ORDER BY c.priority ASC, c.id ASC`,
      [site.id]
    );
    return {
      site,
      campaigns: rows.map((r) => ({
        id: Number(r.id),
        name: r.name as string,
        status: r.status as string,
        priority: r.priority as number,
        holdoutRate: Number(r.holdout_rate),
        creativeCount: Number(r.creative_count),
      })),
    };
  });

  if (!site) {
    return <p>このアカウントにはまだサイトが登録されていません。</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>キャンペーン — {site.name}</h1>
        <NewCampaignButton />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>名前</th>
            <th style={{ padding: 8 }}>状態</th>
            <th style={{ padding: 8 }}>優先度</th>
            <th style={{ padding: 8 }}>対照群比率</th>
            <th style={{ padding: 8 }}>クリエイティブ数</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>
                <a href={`/campaigns/${c.id}`}>{c.name}</a>
              </td>
              <td style={{ padding: 8 }}>{STATUS_LABEL[c.status] ?? c.status}</td>
              <td style={{ padding: 8 }}>{c.priority}</td>
              <td style={{ padding: 8 }}>{(c.holdoutRate * 100).toFixed(0)}%</td>
              <td style={{ padding: 8 }}>{c.creativeCount}</td>
            </tr>
          ))}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, color: "#888" }}>
                まだキャンペーンがありません。「新規作成」から始めてください。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
