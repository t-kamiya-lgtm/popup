# Popup Tool for EC

EC サイトに 1 タグ設置するだけで、離脱防止・クーポン・SNS 誘導などのポップアップバナーを
配信・計測できる SaaS ツール。

## 前提（確定）

| 項目 | 内容 |
| --- | --- |
| 初期導入サイト | https://www.primedirect.jp/ （株式会社プライムダイレクト） |
| カート | スマレジ・リピート（単品リピート通販 / 定期購入）。サンクスページへの JS タグ設置・独自差し込み変数の利用が可能 |
| 商品の識別方式 | **サンクスページのカートイン商品コード**（CV タグの差し込み変数）で識別。ページ URL からは商品を特定しない（`pm100` は商品コードではないと判明） |
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
顧客サイト（LP・商品ページ）        スマレジ・リピート（サンクスページ・同一ドメイン）
   共通タグ（URL ベースの計測のみ）      共通タグ + CV タグ（カートイン商品コード）
        │                                    │
        └──────── 同一ホスト www.primedirect.jp ─────┘
        ▼
   CDN（設定JSON / SDK / 画像） ── Next.js アプリ ── PostgreSQL
```

- クリエイティブの割当は **sessionId のハッシュ**で決定 → サーバ往復ゼロ・Redis 不要
- プライムダイレクトは単一ドメイン構成のため `pz_t`（ドメイン跨ぎ用リンク装飾）は不使用
  （設計は他社導入向けに保持。`09-cart-integration.md` 参照）
- **商品はページ URL では識別しない。** サンクスページの CV タグが受け取る
  「カートイン商品コード」だけを商品の正とする（`pm100` のような URL 上の記号は使わない）
- テナント分離は PostgreSQL の **Row Level Security** で DB レベルに強制

## 設置タグ

全ページ共通:

```html
<script async src="https://cdn.popup.example.com/t.js?sid=SITE_XXXX"></script>
```

商品ページには何も追加設置不要（商品はページ側では識別しないため）。

サンクスページ（CV タグ。カートイン商品コードを必ず含める）:

```html
<script>
  window.pqz = window.pqz || [];
  pqz.push(['conversion', {
    orderId    : '{{注文番号}}',
    productCode: '{{カートイン商品コード}}',   // ★ 商品別レポートの唯一のキー
    value      : {{商品金額}},
    currency   : 'JPY',
    orderType  : 'first'          // 定期の継続注文は 'recurring'
  }]);
</script>
```

## 次のアクション

**Phase 0（実装着手前）の調査** — 進捗と記入シートはこちら
→ **[docs/00-phase0-checklist.md](docs/00-phase0-checklist.md)**

| 調査 | 内容 | 状態 |
| --- | --- | --- |
| A | カート〜注文完了ページの URL | ✅ 完了（**同一ホスト確認・方式A確定**） |
| B | スマレジ・リピートの差し込み変数の名前（**カートイン商品コードを含む**） | 🔲 後日回答予定（開発と並行で可） |
| C | 商品ページの URL と商品コード | ✅ 完了（**商品識別方式を「カートイン商品コード」に確定**） |

**方式A（標準構成）・商品識別方式ともに確定したため、実装（Phase 1）に着手できます。**
技術的な背景・確定した設定値は
[docs/09-cart-integration.md](docs/09-cart-integration.md) を参照。
