# Popup Tool for EC

ECサイトに1タグ設置するだけで、離脱防止・クーポン・SNS誘導などのポップアップバナーを配信・計測できるツール。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [docs/01-requirements.md](docs/01-requirements.md) | 要件整理 / 用語定義 / スコープ |
| [docs/02-architecture.md](docs/02-architecture.md) | システム全体構成 / 技術スタック / 配信フロー |
| [docs/03-data-model.md](docs/03-data-model.md) | データモデル / ER / 集計テーブル設計 |
| [docs/04-api.md](docs/04-api.md) | 配信API / 計測API / 管理API 仕様 |
| [docs/05-tag-sdk.md](docs/05-tag-sdk.md) | 設置タグ仕様 / SDK設計 / トリガー実装方式 |
| [docs/06-admin.md](docs/06-admin.md) | 管理画面の画面設計 / プレビュー / レポート |
| [docs/07-measurement.md](docs/07-measurement.md) | 計測仕様（imp / click / CV）とアトリビューション |
| [docs/08-roadmap.md](docs/08-roadmap.md) | 開発フェーズ / 非機能要件 / リスク |

## クイックイメージ

設置タグ（全ページ共通・1行）:

```html
<script async src="https://cdn.popup.example.com/t.js?sid=SITE_XXXX"></script>
```

コンバージョンタグ（サンクスページのみ追記）:

```html
<script>
  window.pqz = window.pqz || [];
  pqz.push(['conversion', { orderId: '{{注文番号}}', value: {{税抜金額}}, currency: 'JPY' }]);
</script>
```
