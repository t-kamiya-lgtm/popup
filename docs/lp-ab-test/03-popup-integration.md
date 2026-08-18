# 03. popup toolとの連携仕様（案）

## 1. 方針

- popup toolとLP-ABテストツールは、タグ・アプリ・DB（Supabaseプロジェクト）とも
  **完全に独立**させる。DB直結（同一プロジェクト化）は行わない
- ログインも共通化しない。どちらのアプリも `@primedirect.jp` の招待制Google認証だが、
  それぞれ個別にログインする（SSOなし）
- LP一覧・レポートLP一覧の各行に、対応するpopup tool側の画面へのリンクを
  アイコン表示する。対応が無い場合はアイコン自体を非表示にする

## 2. popup tool側に追加が必要なもの

popup tool（既存リポジトリ、`apps/web`）に、以下の**参照専用API**を追加する。

```
GET /api/v1/lookup?path={LPのURLパス}
```

- 認証：サーバー間通信のため、共有シークレット（例：`X-Internal-Token` ヘッダ）で保護する。
  Cookieセッションは使わない
- 挙動：`path`（`url-pattern.ts`で正規化した値）が `campaign_targets` または
  `page_groups` のURLルールにマッチする `campaign` を検索する
  - 0件 → `{ "match": "none" }`
  - 1件 → `{ "match": "campaign", "siteId": ..., "campaignId": ... }`
  - 2件以上 → `{ "match": "multiple", "siteId": ... }`
- サイトが複数ある場合（マルチテナント）は、想定利用が単一サイト
  （`www.primedirect.jp`）のみのため、Phase 1では対象サイトを固定でよい

## 3. LP-ABテストツール側の利用方法

- LP登録・更新時、または一覧表示時に上記APIを呼び出し、結果を
  `popup_link_cache`（[01-data-model.md](01-data-model.md) 11章）にキャッシュする
- リンク先URL：
  - `match: "campaign"` → popup tool側のキャンペーン編集画面
    `{POPUP_ADMIN_BASE_URL}/campaigns/{campaignId}`、
    レポート画面は `{POPUP_ADMIN_BASE_URL}/reports?campaignId={campaignId}`
    （popup tool側のレポート画面がキャンペーンIDでの絞り込みに対応している必要がある。
    現状クエリパラメータでの絞り込み対応状況は実装時に要確認）
  - `match: "multiple"` → popup tool側のキャンペーン一覧画面
    `{POPUP_ADMIN_BASE_URL}/campaigns?siteId={siteId}`
  - `match: "none"` → アイコンを表示しない
- キャッシュのTTL・再検証タイミングは実装時に決定（例：LP一覧表示時に5分以上経過していたら
  バックグラウンドで再取得）

## 4. 環境変数（想定）

LP-ABテストツール側：

```
POPUP_TOOL_LOOKUP_URL=https://{popup-toolのドメイン}/api/v1/lookup
POPUP_TOOL_LOOKUP_TOKEN=（共有シークレット）
POPUP_ADMIN_BASE_URL=https://{popup-toolのドメイン}
```

popup tool側（`.env.example` に追記予定）：

```
INTERNAL_LOOKUP_TOKEN=（LP-ABテストツールと共有するシークレット）
```

## 5. 未確定事項（実装時に詰める）

- popup tool側のレポート画面が `campaignId` クエリパラメータでの絞り込みに
  対応していない場合、その対応もこの連携の一部として実装が必要になる
  （`apps/web/app/(admin)/reports/reports-panel.tsx` の対応状況を要確認）
- `path` の正規化ルール（オリジン・クエリ・ハッシュ除去）は、popup tool側の
  `apps/web/lib/url-pattern.ts` のロジックをそのまま踏襲する
