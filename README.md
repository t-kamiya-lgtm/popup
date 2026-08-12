# Popup Tool for EC

EC サイトに 1 タグ設置するだけで、離脱防止・クーポン・SNS 誘導などのポップアップバナーを
配信・計測できる SaaS ツール。

## Phase 1 実装状況

初期スケルトンを実装済み。動作確認は Playwright で実ブラウザから
タグ設置 → 配信設定取得 → dwell トリガー発火 → Shadow DOM 描画 → imp/click 計測 →
DB 反映まで一通り確認済み（実装時に見つけたバグ 1 件を含め修正済み）。

**実装済み:**
- DB スキーマ（`db/migrations/`）: マスタ・イベント・RLS ポリシー一式。
  RLS 未設定テーブルを検出する CI チェック（`db/check-rls.sql`）
- `packages/shared`: URL マッチャ・ハッシュベースの均等配信ローテーション（22 テスト）
- `packages/sdk`: 設定取得・ターゲティング・フリークエンシー制御・
  トリガー（exit_back / dwell）・Shadow DOM 描画・計測送信・
  CV アトリビューション（29 テスト、うち jsdom 上でのトリガー統合テストを含む）
- `packages/loader`: 3KB のローダ（`t.js`）
- `apps/web`: `GET /c/[siteId]`（配信設定 JSON）、`POST /e`（計測コレクタ）を実装。
  テナント解決は `servicePool`（RLS バイパス）+ 明示的な `site.id` 絞り込みで実施
- 管理画面（`docs/06-admin.md`）: ログイン（iron-session の httpOnly Cookie、
  bcrypt でパスワード照合）、キャンペーン一覧・編集（対象ページ URL ルール／
  表示条件／表示位置／クリエイティブの CRUD）、PC・SP 切り替え可能なライブ
  プレビュー。プレビューは `@popup/sdk/render` の `renderPopup` を SDK と
  共有し、`containerRelative` オプションでプレビュー枠内に描画（本番と
  同じレンダラなので描画のズレが起きない設計）。ログイン → 一覧 → 編集 →
  保存 → プレビュー描画までを実 Postgres + 実ブラウザ（Playwright）で確認済み
- 画像アップロード・自動最適化（`docs/06-admin.md` 3、`apps/web/lib/assets.ts`）:
  管理画面からアップロード → `sharp` で PC/SP 用にリサイズ（幅 380px / 320px）・
  WebP 変換 + JPEG（透過画像は PNG）フォールバック生成 → `assets` /
  `asset_variants` に登録 → `GET /c/[siteId]` の配信設定 JSON とプレビューが
  同じ画像を参照。署名付きURL直接アップロード＋非同期ワーカーという本番構成
  （`docs/06-admin.md` 3.1）の代わりに Phase 1 はリクエスト内で同期処理し
  `apps/web/public/uploads/` に保存 — DB スキーマは同じなので、後で
  オブジェクトストレージに差し替える際は `lib/assets.ts` だけ変更すればよい設計。
  アップロード → 保存 → リロード後の永続化まで実ブラウザで確認済み

**未実装（Phase 1 残り・Phase 2）:**
- 実績レポート UI（imp/click/CV、ページ・商品別、クリエイティブ別）
- 受注API OAuth 連携（`docs/09-cart-integration.md` 3.5〜3.7）
- 日次集計バッチ（`stats_daily`）、対照群（holdout）のレポート反映
- サイト切り替え（複数サイト運用時の管理画面 UI。現状は最初の1件のみ表示）

### ローカルで動かす

```bash
pnpm install
bash db/setup-local.sh                      # ロール・DB作成（初回のみ）
DATABASE_URL=postgresql://popup:popup@localhost:5432/popup_dev node db/migrate.mjs
DATABASE_URL=postgresql://popup_service:popup_service_dev@localhost:5432/popup_dev node db/seed.mjs
pnpm build:client                            # t.js / sdk.js を apps/web/public/ へ
pnpm --filter @popup/web dev                 # http://localhost:3000
```

`GET /c/SITE_PRIMEDIRECT.json` で配信設定、`POST /e` で計測を確認できます。
管理画面は `http://localhost:3000/login`（`db/seed.mjs` が作成する
`owner@example.com` / `password123` でログイン）。
テストは `pnpm -r test`、型チェックは `pnpm -r typecheck`。

## 前提（確定）

| 項目 | 内容 |
| --- | --- |
| 初期導入サイト | https://www.primedirect.jp/ （株式会社プライムダイレクト） |
| カート | スマレジ・リピート（単品リピート通販 / 定期購入）。サンクスページへの JS タグ設置が可能、受注API（`/api/v2/orders/search`）も利用可能 |
| 商品の識別方式 | **サンクスページの `{商品毎出力}` ループタグ**で識別。ページ URL からは商品を特定しない（`pm100` は商品コードではないと判明） |
| CV 連携方式 | サンクスページのタグ（商品コード・数量・金額を即時送信）+ 受注API（初回/継続判定のみ）。1 注文複数商品にも標準対応 |
| 規模 | 月間 1 万 PV 程度（拡大可能性あり） |
| 提供形態 | SaaS・複数アカウント運用（マルチテナント） |
| レポート | 期間指定 × **商品別**（CVのみ） × **ページ別**（imp/clickのみ） × クリエイティブ別 |

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/00-phase0-checklist.md](docs/00-phase0-checklist.md) | **👉 まずここから：着手前の調査手順書（記入シート付き）** |
| [docs/01-requirements.md](docs/01-requirements.md) | 要件整理 / 用語定義 / スコープ |
| [docs/02-architecture.md](docs/02-architecture.md) | システム全体構成 / 技術スタック / 配信フロー / スケール計画 |
| [docs/03-data-model.md](docs/03-data-model.md) | データモデル / ER / 集計テーブル設計 |
| [docs/04-api.md](docs/04-api.md) | 配信API / 計測API / 管理API 仕様 |
| [docs/05-tag-sdk.md](docs/05-tag-sdk.md) | 設置タグ仕様 / SDK設計 / トリガー実装方式 |
| [docs/06-admin.md](docs/06-admin.md) | 管理画面の画面設計 / プレビュー / レポート |
| [docs/07-measurement.md](docs/07-measurement.md) | 計測仕様（imp / click / CV）とアトリビューション |
| [docs/08-roadmap.md](docs/08-roadmap.md) | 開発フェーズ / 設計判断の根拠 / リスク |
| [docs/09-cart-integration.md](docs/09-cart-integration.md) | **スマレジ・リピート連携 / ドメイン跨ぎ CV 計測** |
| [docs/10-multitenancy.md](docs/10-multitenancy.md) | **マルチテナント設計 / テナント分離 / プラン** |

## 構成の要点

```
顧客サイト（LP・商品ページ）        スマレジEC（サンクスページ・同一ドメイン）
   共通タグ（URL ベースの計測のみ）      共通タグ + CVタグ（{商品毎出力}ループで
        │                                    商品コード・数量・金額を即時送信）
        └──────── 同一ホスト www.primedirect.jp ─────┘
        ▼                                    │
   CDN（設定JSON / SDK / 画像） ── Next.js アプリ ── PostgreSQL
                                              ▲
                                   数分おきに受注APIを同期
                                   （初回/継続の判定のみ）
                                              │
                                   スマレジEC 受注API
                                   /api/v2/orders/search
```

- クリエイティブの割当は **sessionId のハッシュ**で決定 → サーバ往復ゼロ・Redis 不要
- プライムダイレクトは単一ドメイン構成のため `pz_t`（ドメイン跨ぎ用リンク装飾）は不使用
  （設計は他社導入向けに保持。`09-cart-integration.md` 参照）
- **商品はページ URL では識別しない。** サンクスページの `{商品毎出力}` ループタグが
  商品コード・数量・金額を即時送信する（`pm100` のような URL 上の記号は使わない）
- 受注API は**「初回購入か2回目以降か」の判定 1 点だけ**に使う。同期が遅延・失敗しても
  商品別レポート・売上・CV数は影響を受けない
- 1 注文に複数商品が含まれる場合も、ループタグが商品の数だけ繰り返されるため標準対応
- テナント分離は PostgreSQL の **Row Level Security** で DB レベルに強制

## 設置タグ

全ページ共通:

```html
<script async src="https://cdn.popup.example.com/t.js?sid=SITE_XXXX"></script>
```

商品ページには何も追加設置不要（商品はページ側では識別しないため）。

サンクスページ（CV タグ。`{商品毎出力}` ループで複数商品に対応）:

```html
<script>
  window.pqz = window.pqz || [];
  var orderId = '{注文番号}';
  if (orderId && orderId.indexOf('{') === -1) {
    window.pqz.push(['conversion', {
      orderId: orderId,
      revenueExTax: {注文金額合計(税別)},
      items: [
        {商品毎出力}{ code: '{商品コード}', qty: {注文個数}, revenueExTax: {商品代金合計(税別)} },{/商品毎出力}
      ]
    }]);
  }
</script>
```

初回/継続の判定のみ、この後**受注API 同期バッチ**が自動的に補完します
（`09-cart-integration.md` 3 章）。

## 次のアクション

**Phase 0 の調査・確認事項はすべて完了しました。実装（Phase 1）に着手しています。**
経緯の記録は → [docs/00-phase0-checklist.md](docs/00-phase0-checklist.md)

| 調査 | 内容 | 状態 |
| --- | --- | --- |
| A | カート〜注文完了ページの URL | ✅ 完了（同一ホスト確認・方式A確定） |
| C | 商品ページの URL と商品識別方法 | ✅ 完了（ループタグ方式に確定） |
| D | スマレジEC 受注APIの仕様 | ✅ 完了 |
| E | サンクスページの差し込みタグ一覧 | ✅ 完了（CV連携方式を最終確定） |
| F | 受注APIのアクセストークン取得方法 | ✅ 完了（OAuth2と判明） |
| B | 初回/継続判定の実装方針 | ✅ 完了（**OAuth連携を Phase 1 で実装**） |

技術的な背景・確定した設定値は
[docs/09-cart-integration.md](docs/09-cart-integration.md) を参照。
