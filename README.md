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
- 受注API OAuth2 連携（`docs/09-cart-integration.md` 3.5、`apps/web/lib/order-api.ts`）:
  管理画面「受注API連携」でクライアントID/シークレットを登録（AES-256-GCM で
  暗号化保存）→ `authorize.php` へ誘導 → callback で `code` を
  トークンに交換（`grant_type=client_credentials`、実機未検証につき要確認と
  コード内に明記）→ 受注API `orders/search` を呼んで `order_cnt` から
  初回/継続を判定し `events.order_type` を更新 → 期限 10 日前を切ったら
  `refresh_token` で自動更新。本番は Cron が呼ぶ想定の同期処理
  （`docs/04-api.md` 1.5.3）を、Phase 1 は管理画面の「今すぐ同期」ボタンから
  同じ関数を呼べるようにして代替。受注APIを一切連携しなくても配信・計測・
  商品別レポートは動作する任意機能（`docs/06-admin.md` 6.5）。
  クレデンシャル登録・authorize リダイレクト・callback・トークン交換・
  同期・`refresh_token` 更新・連携解除までをモックの OAuth/受注API サーバー
  相手に実ブラウザ（Playwright）で確認済み（実装時に見つけたバグ 1 件を
  含め修正済み — `occurred_at` を経由した `UPDATE` が JS `Date` の精度落ちで
  0 件ヒットしていた）
- 管理画面ログイン（`docs/02-architecture.md` — 招待制 Google SSO、
  `apps/web/lib/google-auth.ts`）: パスワードではなく Google Workspace
  アカウントでログイン。自己登録の入口は一切なく、オーナー権限のメンバーが
  「メンバー管理」画面（`POST /api/v1/accounts/{id}/members`）でメール
  アドレスを招待した場合のみ、その Google アカウントで初回ログインした
  瞬間に有効化される（`memberships.accepted_at` を NULL→now() に更新）。
  未招待のメールアドレスは「このメールアドレスは招待されていません」で
  ログイン画面に差し戻し。受注APIの OAuth 連携と同じ手作りの OAuth2 実装
  （Auth.js 等のフレームワークは未導入）。開発用にパスワードログインも
  `/login` に残してあるが、折りたたみ表示にして目立たなくしてある。
  Google の認可エンドポイント3種をモックに差し替え可能にしたうえで、
  招待済みメールでのログイン成功・未招待メールの拒否・オーナー以外による
  招待操作の拒否（403）・重複招待の拒否（409）まで実ブラウザ（Playwright）
  で確認済み
- 実績レポート（`docs/06-admin.md` 5、`apps/web/lib/reports.ts`）: 期間プリセット
  （今日/昨日/過去7日/過去30日/今月/先月/カスタム）、サマリカード（imp/click/CTR/CV/CVR/売上）、
  ページ別（imp/click。`page_groups` 基準）、商品別（CV クリックスルー/ビュースルー・売上。
  サンクスページのループタグ基準、`{商品毎出力}` 設置漏れの「商品明細が空だったCV」行も表示）、
  クリエイティブ別（サムネ・imp/click/CTR/CV/CVR/売上）、CSV出力。`docs/03-data-model.md` の
  `stats_daily`（事前集計テーブル）を使わず `events`/`order_items` への都度 GROUP BY
  クエリで返している — Cron 基盤がまだ無く（受注API同期と同じ制約）、この規模（月間
  1万PV想定）なら都度集計で十分速いための Phase 1 判断。比較（前期間比）・行クリックでの
  ドリルダウンは未実装。実データを投入したうえで imp/click/CTR/CV/CVR/売上の
  集計結果が一致することを確認済み
- レポートの絞り込み（商品・ページ・クリエイティブ）と、詳細データ
  （アイテム×ページ×クリエイティブの組み合わせごとの集計）。この組み合わせを取るには
  CV イベントが「どのページで接触されたか」を知る必要があるが、従来はCVイベントに
  `page_group_id` が記録されていなかった（サンクスページの `event_type='cv'` 行には
  campaign_id/creative_id のみで、page_group_id はカラムはあるのに未設定だった）ため、
  `packages/sdk`（タッチ情報に `pg` を追加）と `apps/web/app/e/route.ts`
  （CVの INSERT に `page_group_id` を追加）を修正し、以降発生するCVから記録されるように
  した。この変更前のCVは「（ページ不明）」として表示される。商品で絞り込むと
  imp/click/ページ別/クリエイティブ別は「該当なし」になる旨を画面上に明記
  （imp/click は商品と結び付いていないため）

**実装中に見つけた別件の本番バグ（今回まとめて修正）:**
- `apps/web/public/sdk.js`/`t.js`（顧客サイトに設置される実タグ本体）はビルド生成物として
  `.gitignore` されており、`apps/web` の `build` スクリプトも元は `next build` のみ
  だったため、**Vercel上の本番デプロイでは一度も生成されず配信タグが 404 していた**
  （ローカルでは `pnpm run build:client` を手動実行していたため気づかず動いて見えていた）。
  `apps/web/package.json` の `build` スクリプトを `packages/loader`/`packages/sdk` の
  ビルド→コピー→`next build` の順に実行するよう修正し、ローカルで
  `cd apps/web && pnpm run build` を実行して `public/sdk.js`/`t.js` が生成されることを確認済み
- タグ管理画面（`docs/06-admin.md` 6章冒頭、`docs/05-tag-sdk.md` 1章）: 共通タグ・
  コンバージョンタグ（`{商品毎出力}` ループ込み）を、そのサイトの `sid`・CDN URL を
  埋め込んだ状態でいつでも確認・コピーできる。設置状況を自動診断する「タグ設置
  チェッカー」（HTML取得検査・24時間受信状況表示、`docs/06-admin.md` 6章）は未実装

**未実装（Phase 1 残り・Phase 2）:**
- 日次集計バッチ（`stats_daily`）— 実績レポート自体は動作済みだが、都度集計の代わりに
  事前集計テーブルを使う形へは未移行（データ量が増えた場合の性能対策として残る作業）
- レポートの前期間比較・行クリックでのドリルダウン
- タグ設置チェッカー（設置状況の自動診断・24時間受信状況表示）
- サイト切り替え（複数サイト運用時の管理画面 UI。現状は最初の1件のみ表示）
- 受注API 同期の Cron 化（現状は管理画面からの手動トリガーのみ）

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
