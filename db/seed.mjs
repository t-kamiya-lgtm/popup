#!/usr/bin/env node
// Local dev seed: one account + the primedirect.jp site + a sample campaign.
// Must run as a role that bypasses RLS (superuser), since seeding creates
// rows across tenants before any app.account_id context exists.
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query("BEGIN");

  const { rows: [account] } = await client.query(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING id`,
    ["プライムダイレクト"]
  );
  await client.query(
    `INSERT INTO accounts_plan (account_id, plan_code, status) VALUES ($1, 'standard', 'active')`,
    [account.id]
  );

  const { rows: [site] } = await client.query(
    `INSERT INTO sites (account_id, public_id, name, allowed_hosts, cart_hosts, cross_domain_cart, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      account.id,
      "SITE_PRIMEDIRECT",
      "プライムダイレクト",
      ["www.primedirect.jp", "primedirect.jp"],
      [],
      false,
      "Asia/Tokyo",
    ]
  );

  await client.query(
    `INSERT INTO page_groups (site_id, name, match_type, pattern, priority) VALUES
       ($1, '商品詳細ページ全体', 'prefix', '/products/', 10),
       ($1, 'protein.html（LP）', 'exact', '/protein.html', 10)`,
    [site.id]
  );

  const { rows: [campaign] } = await client.query(
    `INSERT INTO campaigns (site_id, name, status, triggers, devices, frequency, holdout_rate, position_pc, position_sp)
     VALUES ($1, $2, 'active', $3, $4, $5, 0.1, 'bottom_right', 'center')
     RETURNING id`,
    [
      site.id,
      "サンプルキャンペーン（離脱防止クーポン）",
      JSON.stringify({
        mode: "any",
        rules: [{ type: "exit_back" }, { type: "dwell", seconds: 60 }],
      }),
      ["pc", "sp"],
      JSON.stringify({
        perSession: 1,
        perDay: 2,
        suppressDaysAfterClose: 3,
        suppressAfterClick: true,
        minIntervalSeconds: 300,
      }),
    ]
  );

  await client.query(
    `INSERT INTO campaign_targets (campaign_id, kind, target_type, match_type, pattern) VALUES
       ($1, 'exclude', 'url', 'contains', '/cart'),
       ($1, 'exclude', 'url', 'contains', '/shopping')`,
    [campaign.id]
  );

  await client.query(
    `INSERT INTO creatives (campaign_id, name, status, link_url, alt_text, weight) VALUES
       ($1, 'クーポンA', 'active', 'https://www.primedirect.jp/protein.html', '10%OFFクーポン', 1),
       ($1, 'LINE誘導B', 'active', 'https://line.me/R/ti/p/example', '公式LINE登録', 1)`,
    [campaign.id]
  );

  await client.query("COMMIT");
  console.log(`Seeded account ${account.id}, site ${site.id} (SITE_PRIMEDIRECT), campaign ${campaign.id}`);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.query("ROLLBACK").catch(() => {});
  process.exit(1);
});
