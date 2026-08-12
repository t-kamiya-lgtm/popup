# Popup Tool for EC

EC サイトに 1 タグ設置するだけで、離脱防止・クーポン・SNS 誘導などのポップアップバナーを
配信・計測できる SaaS ツール。

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
