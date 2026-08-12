# 03. データモデル

> **DB は PostgreSQL 一本**（月間 1 万 PV 規模のため）。
> マスタ・イベント・集計をすべて同一 DB に置き、月間 100 万 PV まではこの構成で運用します。
> スケール時の移行方針は `02-architecture.md` 9 章。
> テナント分離（RLS）は `10-multitenancy.md`。

## 1. ER 概要

```mermaid
erDiagram
  ACCOUNT ||--o{ MEMBERSHIP : has
  USER ||--o{ MEMBERSHIP : has
  ACCOUNT ||--o{ SITE : has
  SITE ||--o{ PRODUCT : has
  SITE ||--o{ PAGE_GROUP : has
  SITE ||--o{ CAMPAIGN : has
  SITE ||--o{ CONFIG_VERSION : has
  CAMPAIGN ||--o{ CAMPAIGN_TARGET : has
  CAMPAIGN ||--o{ CREATIVE : has
  CREATIVE }o--|| ASSET : uses
  ASSET ||--o{ ASSET_VARIANT : has
  CAMPAIGN ||--o{ EVENT_IMP : logs
  CREATIVE ||--o{ EVENT_CLICK : logs
  SITE ||--o{ EVENT_CV : logs
```

## 2. マスタ（PostgreSQL）

### accounts / users

```sql
CREATE TABLE accounts (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts_plan (
  account_id   BIGINT PRIMARY KEY REFERENCES accounts(id),
  plan_code    TEXT NOT NULL REFERENCES plans(code),
  status       TEXT NOT NULL CHECK (status IN ('trial','active','past_due','canceled')),
  trial_ends_at TIMESTAMPTZ
);

-- User は複数アカウントに所属できる（代理店運用に対応）
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  accepted_at TIMESTAMPTZ,
  UNIQUE (account_id, user_id)
);
```

### sites

```sql
CREATE TABLE sites (
  id            BIGSERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL REFERENCES accounts(id),
  public_id     TEXT NOT NULL UNIQUE,        -- タグに埋め込む SITE_XXXX（26桁ランダム）
  name          TEXT NOT NULL,
  allowed_hosts TEXT[] NOT NULL DEFAULT '{}',-- 配信/計測を許可するホスト名（なりすまし防止）
  cart_hosts    TEXT[] NOT NULL DEFAULT '{}',-- スマレジ・リピート側のホスト名
  cross_domain_cart BOOLEAN NOT NULL DEFAULT false, -- 別ドメインならビュースルーCV列を隠す
  signing_key   BYTEA NOT NULL,              -- pz_t 署名用（サーバのみ保持）
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  cv_click_window_days INT NOT NULL DEFAULT 7,
  cv_view_window_days  INT NOT NULL DEFAULT 1,
  cv_count_recurring   BOOLEAN NOT NULL DEFAULT false, -- 定期の継続注文をCVに含めるか
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### products（CV・売上レポートの主集計軸）

> **重要な設計変更**（2026-08 確認結果を反映）:
> プライムダイレクトでは商品ページ URL に商品コードが出ていない
> （`pm100` は URL のスラッグであり実際の商品コードではない）ため、
> **「どのページを見たか」で商品を特定するのをやめ、
> 「実際にカートに入って購入された商品コード」を受注API から取得**する方式にします。
>
> ページ側の商品コードタグ（`05-tag-sdk.md` 旧 1.3）は**廃止**します。
> 商品はスマレジEC 受注API の `order_detail.product_code`（明細単位）でのみ識別します
> （`09-cart-integration.md` 3〜4 章）。

```sql
CREATE TABLE products (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,               -- 受注API の order_detail.product_code
  name         TEXT NOT NULL DEFAULT '',    -- order_detail.product_name / 管理画面で編集
  archived     BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, product_code)
);
```

初めて受信した商品コードは、**CV タグ到達時点で即座に** upsert される
（サンクスページの `{商品毎出力}` ループタグが商品コード・数量・金額を直接送るため。
`09-cart-integration.md` 3.2 節）。受注API を待つ必要はない。

### page_groups（ページの分類。imp / click の集計単位）

商品コードがページから取れないため、**imp / click のエンゲージメント集計は
URL ルールベースの page_group が唯一の軸**になります。

```sql
CREATE TABLE page_groups (
  id         BIGSERIAL PRIMARY KEY,
  site_id    BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                -- 例: 「protein.html（LP）」「products/pm100（商品ページ）」
  match_type TEXT NOT NULL CHECK (match_type IN ('exact','prefix','contains','regex')),
  pattern    TEXT NOT NULL,
  priority   INT NOT NULL DEFAULT 100,     -- 小さいほど優先
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON page_groups (site_id, priority);
```

### 商品（product_id）とページ（page_group_id）は別軸として持つ

これまでの設計では「ページ ＝ 商品」という前提でしたが、
**この前提が崩れた**ため、2 つの軸を明確に分離します。

| 軸 | 何で決まるか | どのイベントに付くか | 用途 |
| --- | --- | --- | --- |
| `page_group_id` | 閲覧した URL（URL ルール） | imp / click | 「どのページでバナーが見られ、クリックされたか」＝エンゲージメント |
| `product_id` | **注文の実際の商品コード**（CV タグの差し込み変数） | cv のみ | 「実際に何が売れたか」＝ 売上・CV 実績 |

**imp/click の `product_id` と cv の `product_id` は、同一行でも一致するとは限りません。**
例えば `protein.html`（LP）経由の click に対し、CV では「プロテイン定期便 A」が
購入されたことが分かる、といった形です。したがってレポートの
「商品別」テーブルは**インプレッション・クリックを持たず、CV と売上のみを表示**します
（`06-admin.md` 5.3 節を参照。エンゲージメントは「ページ別」で見ます）。

### campaigns

```sql
CREATE TABLE campaigns (
  id            BIGSERIAL PRIMARY KEY,
  site_id       BIGINT NOT NULL REFERENCES sites(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft','active','paused','archived')),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,

  -- 表示条件
  triggers      JSONB NOT NULL,   -- 下記スキーマ参照
  devices       TEXT[] NOT NULL DEFAULT '{pc,sp,tablet}',
  audience      JSONB NOT NULL DEFAULT '{}',  -- 新規/リピーター、参照元、曜日時間帯
  frequency     JSONB NOT NULL,   -- 表示回数上限・クローズ後の抑制期間
  holdout_rate  NUMERIC(4,3) NOT NULL DEFAULT 0, -- 非表示対照群の比率（効果検証用）

  -- 表示位置
  position_pc   TEXT NOT NULL CHECK (position_pc IN ('bottom_right','bottom_center','bottom_left','center')),
  position_sp   TEXT NOT NULL DEFAULT 'center' CHECK (position_sp IN ('center','bottom')),
  overlay       BOOLEAN NOT NULL DEFAULT true,   -- 背景オーバーレイの有無
  close_button  BOOLEAN NOT NULL DEFAULT true,

  priority      INT NOT NULL DEFAULT 100,        -- 同時該当時の優先度
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`triggers` の JSON スキーマ:

```jsonc
{
  "mode": "any",            // any = OR / all = AND
  "rules": [
    { "type": "exit_back" },
    { "type": "dwell",       "seconds": 60 },
    { "type": "exit_intent", "sensitivity": 20 },   // 上端 20px
    { "type": "scroll",      "percent": 70 },
    { "type": "idle",        "seconds": 30 }
  ]
}
```

`frequency` の JSON スキーマ:

```jsonc
{
  "perSession": 1,
  "perDay": 2,
  "suppressDaysAfterClose": 3,
  "suppressAfterClick": true,
  "minIntervalSeconds": 300
}
```

### campaign_targets（配信対象ページ）

> **設計変更**: 配信対象の指定（ターゲティング）は商品コードでは行えません
> （ページ側に確実な商品コードが無いため）。**URL ルールのみ**で行います。
> `target_type` は将来 他サイト導入時にページへ商品コードを埋め込める場合に
> 備えて残しますが、プライムダイレクトでは `url` のみ使用します。

```sql
CREATE TABLE campaign_targets (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('include','exclude')),
  target_type TEXT NOT NULL CHECK (target_type IN ('product_code','url')),
  match_type  TEXT CHECK (match_type IN ('exact','prefix','contains','regex')), -- url のみ
  pattern     TEXT NOT NULL   -- product_code のときは商品コードそのもの
);
```

判定順序: `exclude` に 1 つでもマッチしたら配信しない → `include` が空なら全ページ対象、
1 件以上あればいずれかにマッチした場合のみ配信。

### assets / asset_variants（画像の自動最適化）

```sql
CREATE TABLE assets (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id),
  original_key TEXT NOT NULL,        -- オブジェクトストレージのキー
  width        INT NOT NULL,
  height       INT NOT NULL,
  bytes        BIGINT NOT NULL,
  mime         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('processing','ready','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset_variants (
  id        BIGSERIAL PRIMARY KEY,
  asset_id  BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  purpose   TEXT NOT NULL,   -- 'sp' | 'pc'
  dpr       INT NOT NULL,    -- 1 | 2
  format    TEXT NOT NULL,   -- 'avif' | 'webp' | 'png'
  width     INT NOT NULL,
  height    INT NOT NULL,
  url       TEXT NOT NULL,
  bytes     BIGINT NOT NULL
);
```

### creatives

```sql
CREATE TABLE creatives (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active','paused')),
  asset_pc_id BIGINT REFERENCES assets(id),
  asset_sp_id BIGINT REFERENCES assets(id),   -- 未設定なら PC 画像を自動リサイズして流用
  alt_text    TEXT NOT NULL DEFAULT '',
  link_url    TEXT NOT NULL,
  link_target TEXT NOT NULL DEFAULT '_blank' CHECK (link_target IN ('_self','_blank')),
  weight      INT NOT NULL DEFAULT 1,          -- 既定 1 = 均等配信
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> **均等配信**は `weight` を全て 1 にした状態のラウンドロビンで実現。
> 将来的に「勝ちパターンに寄せる」運用をしたくなった時に weight を触るだけで拡張できる。

### config_versions（CDN へ publish するスナップショット）

```sql
CREATE TABLE config_versions (
  id          BIGSERIAL PRIMARY KEY,
  site_id     BIGINT NOT NULL REFERENCES sites(id),
  version     BIGINT NOT NULL,
  payload     JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  UNIQUE (site_id, version)
);
```

## 3. イベント（PostgreSQL）

月間 2,000 件程度のため、専用の分析 DB は使わず PostgreSQL に格納する。
将来の移行を容易にするため、初めから月次パーティションで作成しておく。

```sql
CREATE TABLE events (
  id             BIGSERIAL,
  event_id       UUID NOT NULL,            -- 冪等キー（クライアント生成）
  occurred_at    TIMESTAMPTZ NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id     BIGINT NOT NULL,
  site_id        BIGINT NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('imp','click','cv','close','holdout')),
  campaign_id    BIGINT,
  creative_id    BIGINT,
  config_version BIGINT,
  page_group_id  BIGINT,
  page_path      TEXT,
  device         TEXT CHECK (device IN ('pc','sp','tablet')),
  visitor_id     TEXT,                     -- 1st-party ID（サイト単位・クロスサイト追跡なし）
  session_id     TEXT,
  trigger_type   TEXT,
  position       TEXT,
  -- CV 用（09-cart-integration.md 3章参照）
  order_id       TEXT,
  order_type     TEXT CHECK (order_type IN ('first','recurring','unknown')) DEFAULT 'unknown',  -- 受注APIから後日補完
  revenue        NUMERIC(12,2),             -- サンクスページのタグから即時取得（明細内訳は order_items）
  attribution    TEXT CHECK (attribution IN ('none','click','view')),
  latency_sec    INT,                      -- 接触から CV までの秒数
  order_type_status TEXT CHECK (order_type_status IN ('pending','confirmed')) DEFAULT 'pending',
  order_type_synced_at TIMESTAMPTZ,        -- 受注APIとの突合が完了した時刻（初回/継続判定のみ）
  is_bot         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE UNIQUE INDEX ON events (event_id, occurred_at);
CREATE UNIQUE INDEX events_cv_order ON events (site_id, order_id)
  WHERE event_type = 'cv' AND order_id IS NOT NULL;
CREATE INDEX ON events (site_id, occurred_at DESC);
CREATE INDEX events_order_type_pending ON events (site_id, order_id) WHERE order_type_status = 'pending';
```

- `event_id` で重複排除（ネットワーク再送・ページ再読込対策）
- CV は部分ユニークインデックスで `site_id + order_id` の重複を**DB レベルで**排除
- パーティションは月次。13 ヶ月経過したパーティションを `DROP` して保持期限を実装
- **CV イベントは受信時点でほぼ確定する**: サンクスページの `{商品毎出力}` ループタグが
  `order_id` / `revenue` / 商品明細（→ `order_items`）を直接送るため、API の応答を待たない
  （`09-cart-integration.md` 3.2 節）。唯一 `order_type`（初回/継続）だけは
  差し込みタグに該当が無いため、受注API 同期バッチが後追いで補完する
  （`order_type_status='pending'` → `'confirmed'`。3.4 節）

### order_items（サンクスページのループタグから取得した注文明細）

商品別レポートの実体はこのテーブルです。`events` の `product_id` カラムは持ちません
（1 注文が複数商品を含みうるため、1 対 1 のカラムでは表現できないことが
`{商品毎出力}` ループタグの仕様から判明したためです）。

```sql
CREATE TABLE order_items (
  id           BIGSERIAL PRIMARY KEY,
  site_id      BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  order_id     TEXT NOT NULL,              -- events.order_id と対応
  line_no      INT NOT NULL,               -- CVイベント内の items 配列の並び順
  product_id   BIGINT NOT NULL REFERENCES products(id),
  product_code TEXT NOT NULL,              -- スナップショット（product_code 変更に強くする）
  quantity     INT NOT NULL,
  revenue      NUMERIC(12,2) NOT NULL,     -- items[].revenueExTax
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, order_id, line_no)
);
CREATE INDEX ON order_items (site_id, product_id);
```

- **CV イベント受信時に即座に**書き込まれる（`items` 配列をそのまま 1 行 1 レコードへ展開。
  受注APIの同期を待たない。`09-cart-integration.md` 3.2〜3.3 節）
- 商品別レポートの CV・売上は、`order_items` を `events`（`site_id + order_id` で結合）
  経由してキャンペーン・クリエイティブに紐づけて集計する（アトリビューションは
  注文単位で決まり、注文内の全商品に同じキャンペーンが帰属する）

### `page_group_id` は imp/click のみに入る

| event_type | `page_group_id` |
| --- | --- |
| `imp` / `click` / `close` / `holdout` | URL ルールでマッチした値 |
| `cv` | `NULL`（サンクスページは分類対象外。商品情報は `order_items` に持つ） |

## 4. ロールアップ（レポート用）

レポートは常にこのテーブルを参照する（生イベントを直接クエリするコードは書かない。
将来イベントストアを差し替えた際にレポート側を修正せずに済むため）。

```sql
CREATE TABLE stats_daily (
  date           DATE NOT NULL,
  account_id     BIGINT NOT NULL,
  site_id        BIGINT NOT NULL,
  campaign_id    BIGINT NOT NULL DEFAULT 0,
  creative_id    BIGINT NOT NULL DEFAULT 0,
  product_id     BIGINT NOT NULL DEFAULT 0,
  page_group_id  BIGINT NOT NULL DEFAULT 0,
  device         TEXT NOT NULL,
  imps           BIGINT NOT NULL DEFAULT 0,
  clicks         BIGINT NOT NULL DEFAULT 0,
  closes         BIGINT NOT NULL DEFAULT 0,
  cv_click       BIGINT NOT NULL DEFAULT 0,
  cv_view        BIGINT NOT NULL DEFAULT 0,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  holdout_sessions BIGINT NOT NULL DEFAULT 0,  -- 対照群として「出さなかった」回数
  holdout_cv     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, campaign_id, creative_id, product_id, page_group_id, device)
);
```

`product_id` と `page_group_id` は互いに排他です（前節参照）。
1 行の中で `product_id <> 0` の行は `imps/clicks = 0`・`cv/revenue` のみが入り、
`page_group_id <> 0` の行は `cv/revenue = 0`・`imps/clicks` のみが入ります。

**`product_id` 行の作り方**: `order_items` を `events`（`site_id + order_id` で結合）と
突き合わせ、`order_items.product_id` ごとに `revenue` を合計、`events.order_id` の
distinct 数を `cv_click`/`cv_view` として集計する（キャンペーン・クリエイティブ・
attribution は結合元の `events` 行から引き継ぐ）。`order_type_status` の確定を待たずに
集計できる（`order_type` は「初回のみ」フィルタ時にのみ参照する）。

管理画面の集計軸は、このテーブルの GROUP BY だけで全て満たせる:

| 画面 | GROUP BY | 見られる指標 |
| --- | --- | --- |
| 期間サマリ | date | 全指標（キャンペーン全体の合計） |
| **商品別**（実売上） | `product_id`（`<> 0` の行のみ） | cv, revenue のみ（imp/click は持たない） |
| **ページ別**（エンゲージメント） | `page_group_id`（`<> 0` の行のみ） | imp, click, CTR のみ（cv は持たない） |
| クリエイティブ別 | creative_id | 全指標（campaign 経由の touch で紐づくため imp/click/cv すべて出せる） |
| デバイス別 | device | 全指標 |
| キャンペーン別 | campaign_id |

集計は日次 Cron で `events` / `order_items` から `INSERT ... ON CONFLICT DO UPDATE`。
CV・商品・売上はサンクスページのタグ到達時点でほぼ確定するが、
`order_type`（初回/継続）だけは受注API 同期の遅延を含めて確定に時間差があるため、
**毎回過去 8 日分を再集計**する（`order_type_status='pending'` のまま 8 日を超えた
CV は「初回/継続 判定不能」として `order_type='unknown'` 扱いにし、
「初回のみ」フィルタ時は除外せず注記付きで含める）。

## 5. 保持ポリシー

| データ | 保持期間 |
| --- | --- |
| 生イベント (events) | 13 ヶ月 |
| ロールアップ (stats_daily) | 無期限 |
| 生ログ (Object Storage) | 90 日 |
| visitor_id | 最終アクセスから 13 ヶ月で削除 |
