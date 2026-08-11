# 02. システム全体構成

## 1. コンポーネント全体像

```mermaid
flowchart LR
  subgraph EC["EC サイト（顧客ドメイン）"]
    TAG["共通タグ t.js"]
    CVTAG["CV タグ（サンクスページ）"]
  end

  subgraph EDGE["CDN / Edge"]
    CDNJS["SDK バンドル sdk.js"]
    CDNCFG["配信設定 JSON /c/{siteId}.json"]
    IMG["最適化画像 (WebP/AVIF)"]
    COLL["計測エンドポイント /e (Edge Function)"]
    DEC["配信決定 /d (Edge Function)"]
  end

  subgraph CORE["アプリケーション基盤"]
    API["管理 API (REST)"]
    ADMIN["管理画面 SPA"]
    IMGPROC["画像最適化ワーカー"]
    AGG["集計バッチ / ストリーム"]
  end

  subgraph DATA["データストア"]
    PG[("PostgreSQL\n設定・マスタ")]
    REDIS[("Redis\nローテーション/レート")]
    S3[("Object Storage\n原本画像・生ログ")]
    OLAP[("列指向DB\nイベント/集計")]
  end

  TAG --> CDNJS
  TAG --> CDNCFG
  TAG --> DEC
  TAG --> IMG
  TAG -- imp/click --> COLL
  CVTAG -- cv --> COLL

  COLL --> S3
  COLL --> OLAP
  DEC --> REDIS
  ADMIN --> API
  API --> PG
  API --> OLAP
  API --> IMGPROC
  IMGPROC --> S3
  IMGPROC --> IMG
  AGG --> OLAP
  PG -- publish --> CDNCFG
```

## 2. レイヤ責務

| レイヤ | 責務 | 備考 |
| --- | --- | --- |
| ローダ (`t.js`) | サイト ID の解決、SDK の遅延ロード、コマンドキュー受付 | 極小・長期キャッシュしない (max-age=300) |
| SDK (`sdk.js`) | トリガー監視、ターゲティング判定、描画、計測送信 | immutable キャッシュ（ハッシュ付きファイル名） |
| 配信設定 (`/c/{siteId}.json`) | サイト配下の有効キャンペーン・クリエイティブ定義 | 管理画面の保存時に publish → CDN パージ |
| 配信決定 (`/d`) | 均等配信のクリエイティブ割当（Redis カウンタ） | 失敗時は SDK 側のクライアント乱択にフォールバック |
| 計測 (`/e`) | imp/click/cv の受信・正規化・エンキュー | 1x1 GIF ではなく 204 応答 |
| 管理 API | CRUD・画像処理起動・レポート取得 | 認証は Cookie セッション + CSRF |
| 集計 | 生イベント → 日次/時次ロールアップ | レポートは常にロールアップを参照 |

## 3. 技術スタック（推奨）

| 領域 | 選定 | 理由 |
| --- | --- | --- |
| SDK | TypeScript + esbuild（依存なし・IIFE） | サイズ最小化。Shadow DOM で CSS 完全隔離 |
| Edge | Cloudflare Workers（または CloudFront + Lambda@Edge） | 低レイテンシ、KV で設定配信、DDoS 耐性 |
| 管理画面 | Next.js (App Router) + TypeScript + Tailwind | プレビューを SDK レンダラと共有しやすい |
| 管理 API | Node.js (Fastify) / Next.js Route Handlers | 同一言語でレンダラ共有 |
| 設定 DB | PostgreSQL | 整合性が要るマスタ |
| イベント DB | ClickHouse（小規模なら Postgres + 日次ロールアップ） | imp が数千万/月規模になるため列指向 |
| キュー | SQS / Cloudflare Queues | 計測の書き込み平準化 |
| 画像 | Sharp + Object Storage + CDN 変換 | WebP/AVIF・2x 生成 |
| 監視 | Sentry + Datadog/CloudWatch | フロント例外も収集 |

> 規模が小さい立ち上げ期は **Postgres 一本 + 日次ロールアップ** で開始し、
> イベント量が月間 1,000 万 imp を超えた段階で ClickHouse へ移行する前提の設計にする。

## 4. 配信シーケンス

```mermaid
sequenceDiagram
  participant U as 訪問者ブラウザ
  participant C as CDN
  participant D as /d 配信決定
  participant E as /e 計測

  U->>C: t.js 取得（async）
  C-->>U: ローダ
  U->>C: /c/{siteId}.json 取得（stale-while-revalidate）
  C-->>U: 配信設定（キャンペーン・クリエイティブ一覧）
  Note over U: URL / デバイス / 期間 / フリークエンシー を<br/>クライアント側で判定 → 候補キャンペーン確定
  U->>D: 候補キャンペーンの creative 割当要求（初回のみ）
  D-->>U: creativeId（ラウンドロビン）+ 画像 URL
  Note over U: 画像を先読み（decode 済みで待機）
  Note over U: トリガー発火（戻る / 60秒経過 など）
  U->>U: Shadow DOM に描画
  U->>E: imp イベント (sendBeacon)
  U->>E: click イベント → リンク先へ遷移
```

## 5. CV 計測シーケンス

```mermaid
sequenceDiagram
  participant U as 訪問者ブラウザ
  participant E as /e 計測
  participant Q as キュー/集計

  Note over U: バナークリック時に<br/>touch = {campaignId, creativeId, ts, type:'click'} を<br/>1st-party localStorage に保存（最大 7 日）
  U->>U: サンクスページ到達（CV タグ発火）
  U->>E: cv イベント + touch 情報 + orderId + 金額
  E->>Q: 重複排除（orderId 単位）→ アトリビューション付与
  Q-->>Q: 日次ロールアップへ反映
```

## 6. 設定配信の一貫性

- 管理画面で保存 → `config_versions` に不変スナップショットを追加 → CDN(KV) へ publish → 旧版パージ
- SDK は `configVersion` を imp/click/cv に添付し、**どの設定で出た表示か**を後から追跡可能にする
- publish 失敗時は旧版がそのまま配信され続ける（fail-safe）

## 7. 障害時のふるまい（フェイルセーフ設計）

| 障害 | ふるまい |
| --- | --- |
| 設定 JSON 取得失敗 | 何も表示しない（サイトに影響を出さない） |
| `/d` 応答なし | SDK 側で重み付き乱択にフォールバック |
| `/e` 送信失敗 | localStorage にキューし次回訪問時に再送（最大 3 回 / 24 時間） |
| SDK 内で例外 | 全エントリポイントを try/catch。例外時は即 teardown し DOM を撤去 |
| 広告ブロッカー | 計測は 1st-party サブドメイン（例: `pz.顧客ドメイン`）へ CNAME 可能な構成にする |
