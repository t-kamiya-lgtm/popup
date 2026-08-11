# Popup Tool for EC

EC サイトに 1 タグ設置するだけで、離脱防止・クーポン・SNS 誘導などのポップアップバナーを
配信・計測できる SaaS ツール。

## 前提（確定）

| 項目 | 内容 |
| --- | --- |
| 初期導入サイト | https://www.primedirect.jp/ （株式会社プライムダイレクト） |
| カート | スマレジ・リピート（単品リピート通販 / 定期購入）。サンクスページへの JS タグ設置・独自差し込み変数の利用が可能 |
| 商品コード | タグで受け渡し可 → レポートの主集計軸 |
| 規模 | 月間 1 万 PV 程度（拡大可能性あり） |
| 提供形態 | SaaS・複数アカウント運用（マルチテナント） |
| レポート | 期間指定 × 商品別 × クリエイティブ別（imp / click / CV） |

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
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
顧客サイト（LP・商品ページ）        スマレジ・リピート（カート）
   共通タグ + 商品コードタグ            共通タグ + CV タグ
        │                                    ▲
        │ バナークリック時に pz_t を付与 ─────┘
        ▼
   CDN（設定JSON / SDK / 画像） ── Next.js アプリ ── PostgreSQL
```

- クリエイティブの割当は **sessionId のハッシュ**で決定 → サーバ往復ゼロ・Redis 不要
- ドメインを跨ぐ CV は **クリック時のリンク装飾（`pz_t`）**で 100% 引き継ぐ
- 商品コードはタグから受領 → URL ルールによる推測が不要
- テナント分離は PostgreSQL の **Row Level Security** で DB レベルに強制

## 設置タグ

全ページ共通（顧客サイト・カート双方）:

```html
<script async src="https://cdn.popup.example.com/t.js?sid=SITE_XXXX"></script>
```

商品ページ:

```html
<script>
  window.pqz = window.pqz || [];
  pqz.push(['page', { productCode: '{{商品コード}}', productName: '{{商品名}}', pageType: 'product' }]);
</script>
```

サンクスページ:

```html
<script>
  window.pqz = window.pqz || [];
  pqz.push(['conversion', {
    orderId  : '{{注文番号}}',
    value    : {{商品金額}},
    currency : 'JPY',
    orderType: 'first'          // 定期の継続注文は 'recurring'
  }]);
</script>
```

## 次のアクション

**Phase 0（実装着手前）** — 残タスクは実質 2 つ
→ [docs/09-cart-integration.md](docs/09-cart-integration.md) 1.1 のチェックリスト

1. **カート〜サンクスページのホスト名**（所要 1 分）
   `www.primedirect.jp` のままか、途中で別ホストに変わるかで計測方式が決まる
2. **差し込み変数の正確な変数名**（注文番号 / 金額 / 初回・継続の別）
