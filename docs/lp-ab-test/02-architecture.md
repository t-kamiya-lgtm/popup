# 02. アーキテクチャ（案）

## 1. 全体構成

```
LP（カートシステム上の既存ページ）
   共通タグ（差し替えJS・imp計測）
        │
        ▼
   Supabase（Postgres + Auth + Storage） ── Vercel（Next.js 管理画面 + API）
        ▲                                          │
        │                                   日次Cron（Vercel Cron）
サンクスページ（CVタグ・独立設置）                 - 自動最適化バッチ
                                                    - レポート日次ロールアップ
```

- popup toolとはSupabaseプロジェクト・Vercelプロジェクトともに**分離**する
  （7章・[03-popup-integration.md](03-popup-integration.md)）
- 権限モデルが社内単一組織で完結するため、popup toolのようなマルチテナントRLSは採用せず、
  `members.role` によるアプリケーション層の権限チェックのみで運用する

## 2. 配信タグ

- LPに設置する共通タグは1本。読み込み時に以下を行う：
  1. `session_id` を発行/復元（1st-party、Cookie or localStorage）
  2. 設定JSON（このLPのスロット構成・各クリエイティブの表示率・元画像URL）を取得
  3. `session_id` のハッシュ値を使い、スロットごとに独立してクリエイティブを1つ決定
     （popup toolと同じ「サーバ往復なしのハッシュベースローテーション」方式。
     同一セッションには同じ組み合わせを出し続ける）
  4. 対象の `<img>` 要素の `src` を決定したクリエイティブの画像URLに書き換える
  5. imp計測を送信（LP表示時点）
- 対象画像の指定は、`lp_slots.original_image_url` との**完全一致**で該当要素を探す
  （複数該当した場合の挙動は実装時に確定。基本は1LPにつき1箇所ずつの想定）

## 3. CV計測

- サンクスページに、popup toolとは**別の独立したCVタグ**を設置する
- CVタグは、LP訪問時に発行された `session_id` を注文情報と一緒に送信する
  （同一ドメイン運用が前提。ドメインを跨ぐ場合はリンク装飾等の追加検討が必要）
- サーバー側は `session_id` から直近の `impressions` 行を引き当て、その時点の
  `creative_a_id`/`creative_b_id` を `conversions` にスナップショットとして記録する

## 4. 自動最適化バッチ

- Vercel Cronで日次実行
- 対象：`lp_slots.optimization_mode = 'auto'` のスロットのうち、
  `slot_optimization_settings` の最低imp/CV件数を満たしているもの
- 手順：
  1. スロット内の `active` かつ `is_locked = false` のクリエイティブについて、
     直近の `stats_daily` からCVR（cv/imps）を算出
  2. CVRが高い順に表示率を傾斜配分（配分ロジックの詳細は実装時にチューニング。
     下限フロアを下回らないよう `slot_optimization_settings.floor_mode` に従う）
  3. `is_locked = true` のクリエイティブは現在の `weight_percent` を維持し、
     残りの割合を対象クリエイティブ間で再配分する
  4. 停止中（`status='paused'`）のクリエイティブは常に0%
  5. 変更内容を `creative_status_events`（`event_type='optimized'`）に記録

## 5. レポート

- 日次ロールアップ（`stats_daily`）を基本のクエリ対象にする
- カレンダー式の変更履歴ビューは `creative_status_events` から都度再構成する
  （5章の考え方通り、スナップショットテーブルは持たない）
- 有意差フラグは、選択中の2パターン（またはそれ以上）のCVRについて比率の検定を
  アプリ側で都度計算し、サンプルサイズが小さい場合は「判定不可」を表示する
- CSVダウンロードは、画面に表示中の絞り込み条件をそのままサーバーに渡して生成する
  （popup toolのCSV出力と同じ考え方）

## 6. 画像アップロード・プレビュー

- Supabase Storageに保存し、popup toolの`assets`/`asset_variants`と同様に
  PC/SP向けのリサイズ・WebP変換を行う（Phase 1はリクエスト同期処理でよい。
  規模が大きくなった場合に非同期ワーカー化を検討）
- アップロード時、対象スロットの基準サイズとの差分をチェックし、
  大きく異なる場合はアップロード確認画面で警告を表示する

## 7. 認証・権限

- Supabase Auth（Google OAuth Provider）、`@primedirect.jp` ドメイン限定
- 自己登録なし。`members` テーブルに `admin` が先に招待レコードを作成し、
  初回ログイン時に紐付ける（popup toolの招待フローと同じ考え方だが、実装は
  Supabase Auth上で行う）
- 画面・APIともに `members.role` を見た認可チェックを行う
  （`viewer` は参照系のみ、`editor` はLP/クリエイティブ操作可・メンバー管理不可、
  `admin` は全操作可）

## 8. タグ設置チェッカー

- 対象LPのURLに定期的にHTTPリクエストを行い、レスポンスHTML内に配信タグ・
  （スロットが設定されていれば）対象画像URLが存在するかを診断する
- 過去24時間のimp受信有無も合わせて表示し、「タグは設置されているが計測が来ていない」
  ケースを検知できるようにする（popup toolで未実装のまま残っている機能だが、
  今回は先に実装する）
