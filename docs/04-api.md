# 04. API 仕様

## 1. 配信系（パブリック / CDN・Edge）

### 1.1 配信設定取得

```
GET https://app.popup.example.com/c/{sitePublicId}.json
Cache-Control: public, s-maxage=60, stale-while-revalidate=600
```

Next.js の Route Handler で生成し、CDN でキャッシュする（別途 publish バッチは不要）。

レスポンス:

```jsonc
{
  "v": 128,                       // configVersion
  "site": {
    "id": "SITE_XXXX", "tz": "Asia/Tokyo",
    "cartHosts": ["cart.example.com"],   // このホストでは軽量モードで動作
    "crossDomainCart": true
  },
  "sdkUrl": "https://cdn.popup.example.com/sdk.8f3a91.js",
  "endpoints": { "collect": "https://app.popup.example.com/e" },
  "tokens": {                     // pz_t 用の日次署名（vid/sid は含まない）
    "9002": "MjAyNjA4MTF8OTAwMnw5ZjJhLi4u"
  },
  "pageGroups": [
    { "id": 11, "match": "prefix", "pattern": "/lp/teiki-a", "priority": 10 }
  ],
  "campaigns": [
    {
      "id": 501,
      "priority": 100,
      "period": { "from": "2026-08-01T00:00:00+09:00", "to": null },
      "targets": {
        // ページ側に確実な商品コードが無いため URL ルールのみで判定する
        "urls": {
          "include": [{ "match": "prefix", "pattern": "/lp/" }],
          "exclude": [{ "match": "contains", "pattern": "/cart" }, { "match": "contains", "pattern": "/shopping" }]
        }
      },
      "devices": ["pc", "sp"],
      "audience": { "visitorType": "any", "hours": null },
      "triggers": { "mode": "any", "rules": [
        { "type": "exit_back" }, { "type": "dwell", "seconds": 60 }
      ]},
      "frequency": { "perSession": 1, "perDay": 2, "suppressDaysAfterClose": 3,
                     "suppressAfterClick": true, "minIntervalSeconds": 300 },
      "holdoutRate": 0.1,
      "render": {
        "positionPc": "bottom_right",
        "positionSp": "center",
        "overlay": true,
        "closeButton": true,
        "maxWidthPc": 380,
        "maxWidthSpVw": 86
      },
      "creatives": [
        {
          "id": 9001, "weight": 1, "linkUrl": "https://shop.example.com/coupon",
          "linkTarget": "_blank", "alt": "10%OFFクーポン",
          "images": {
            "pc": { "w": 380, "h": 300,
                    "avif": "https://img.../9001_pc.avif",
                    "avif2x": "https://img.../9001_pc@2x.avif",
                    "webp": "https://img.../9001_pc.webp",
                    "fallback": "https://img.../9001_pc.png" },
            "sp": { "w": 320, "h": 400, "avif": "...", "webp": "...", "fallback": "..." }
          }
        }
      ]
    }
  ]
}
```

設計上のポイント:

- **設定は全部まとめて 1 リクエスト**。ページ判定・条件判定はクライアントで行い、往復を増やさない
- 個人情報・URL ごとの分岐を含まないため、CDN で全ユーザー共通キャッシュ可能
- サイズが 100KB を超える規模になったらキャンペーン単位でシャーディングする

### 1.2 配信決定（サーバ API は不要）

当初案にあった `/d` エンドポイントは**廃止**しました。
クリエイティブの割当は `sessionId` のハッシュによる決定論的ローテーションで
クライアント側で完結します（`02-architecture.md` 3 章）。

これにより、
- サーバ往復が消えて表示が速くなる
- Redis が不要になる
- アプリがダウンしても配信が継続する（CDN キャッシュのみで動作）

holdout（対照群）の判定も同様に `hash(sessionId + ':holdout:' + campaignId) % 1000 < holdoutRate * 1000`
で決定します。乱数ではなくハッシュを使うため、**同一セッションで判定がぶれません**。（統計上ほぼ均等）

### 1.3 計測

```
POST /e   Content-Type: application/json  (sendBeacon / keepalive fetch)
```

```jsonc
{
  "sid": "SITE_XXXX",
  "v": 128,
  "events": [
    {
      "id": "018f...-uuid",            // 冪等キー
      "t": "imp",                       // imp | click | cv | close | holdout
      "ts": 1786500000000,
      "cid": 501, "crid": 9002,
      "url": "https://shop.example.com/protein.html?utm_source=mail",
      "pg": 11,                          // pageGroupId（URL ルールでマッチした値。imp/click は商品コードを持たない）
      "dev": "sp", "pos": "center", "trg": "exit_back",
      "vid": "v_abc", "sesid": "s_def"
    }
  ]
}
```

CV イベントのみ追加フィールド。**受注API 連携（`09-cart-integration.md` 3 章）を
前提とし、クライアントから送るのは注文番号とタッチ情報のみ**にしています
（商品コード・金額・初回/継続の判定は受注API 同期バッチが後追いで補完します）。

```jsonc
{
  "t": "cv",
  "orderId": "EC-20260811-0001",      // order.ec_order_id と一致させる（唯一必須）
  "touch": { "cid": 501, "crid": 9002, "type": "click", "ts": 1786490000000 }
}
```

- 応答は常に `204 No Content`（レスポンスボディ無しで最速）
- サーバ側検証: `Origin` が `sites.allowed_hosts` に含まれるか、`touch.ts` が CV ウィンドウ内か
- この時点では `events.sync_status = 'pending'`。受注API 同期バッチが
  `order_type` / `revenue` / `order_items`（商品コード・数量）を補完し
  `sync_status = 'confirmed'` にする（`03-data-model.md` 3 章）
- `orderId` が空の場合は送信しない（重複排除キーが無い CV は受注APIと突合できない）

> `touch.tok`（HMAC 署名）は、カートが別ドメインの場合にのみ必要です。
> プライムダイレクトは単一ドメイン構成のため、この節は付与しません（`09-cart-integration.md` 参照）。

### 1.3.1 別ドメインからの接触引き継ぎ（`pz_t`）

バナークリック時、リンク先 URL に `pz_t` を付与して接触情報をカートドメインへ渡します。
仕様は `09-cart-integration.md` 2 章（方式B）を参照。

```
GET https://cart.example.com/item/1001?pz_t=<base64url payload>
```

カート側 SDK は起動時にこれを検証・保存し、`history.replaceState` で URL から除去します。

### 1.4 S2S コンバージョン API（任意 / 精度重視オプション）

```
POST /api/v1/conversions
Authorization: Bearer {siteApiKey}
```

```jsonc
{ "orderId": "EC-20260811-0001",
  "pzToken": "eyJ2aWQiOi...",          // 注文時に引き継げた場合（最も正確）
  "visitorId": "v_abc",                 // pzToken が無い場合の代替キー
  "occurredAt": "2026-08-11T12:00:00+09:00",
  "orderType": "first", "revenue": 5400 }
```

サーバ側で `pzToken` → `visitorId` の順に接触を検索してアトリビューションを付与。
ブラウザ CV と `orderId` で重複排除する（S2S を正とする）。
サンクスページに JS タグを設置できない顧客カート向けの経路として設計を保持します
（プライムダイレクトでは 1.5 節の方式を使うため、これは未使用）。

### 1.5 受注API 同期（内部バッチ・こちらがスマレジECを呼び出す）

1.4 節が「相手からこちらへ push してもらう」方式なのに対し、これは
**こちらから相手の受注API を pull しにいく**方式です。プライムダイレクトが
スマレジEC・受注API を提供しているため、こちらを主経路として採用しています
（`09-cart-integration.md` 3〜4 章に詳細設計）。

```
[内部バッチ: サーバ側 Cron ジョブ]
GET/POST https://{カートのAPIドメイン}/api/v2/orders/search
Authorization: Bearer {サイトごとに登録した access_token}

body: {
  "search_options": { "update_date_from": "{前回同期時刻}" },
  "response_options": { "response_type": "json" }
}
```

処理内容:

1. `sites.orderApi`（`accessToken` / `baseUrl` / 前回同期時刻）を site ごとに読む
2. `order.ec_order_id` を `events.order_id`（`sync_status='pending'`）と突合
3. マッチした注文の `order_detail[]` を `order_items` へ展開して書き込む
4. `order.order_cnt` から `order_type` を決定し、`events` を `sync_status='confirmed'` に更新
5. 8 日以上 `pending` のまま残る CV は「注文突合失敗」として管理画面にアラート

このエンドポイントは管理 API・計測 API のどちらとも異なり、**顧客のカート API を
こちらが呼び出す内部ジョブ**である点に注意してください（顧客からのリクエストを
受ける形ではありません）。

## 2. 管理 API（認証必須 / REST）

| メソッド | パス | 概要 |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | ログイン（Cookie セッション） |
| GET | `/api/v1/accounts` | 所属アカウント一覧（切替用） |
| POST | `/api/v1/accounts/{id}/members` | メンバー招待 |
| GET | `/api/v1/accounts/{id}/usage` | プラン・使用量（imp クォータ） |
| GET/POST | `/api/v1/sites` | サイト一覧 / 作成 |
| GET/PATCH | `/api/v1/products` | 商品一覧（自動登録された商品コード）/ 名称編集 |
| GET | `/api/v1/sites/{id}/tag` | 設置タグのスニペット取得 |
| GET/POST/PATCH/DELETE | `/api/v1/campaigns` | キャンペーン CRUD |
| POST | `/api/v1/campaigns/{id}/publish` | 設定を CDN へ publish |
| GET/POST/PATCH/DELETE | `/api/v1/creatives` | クリエイティブ CRUD |
| POST | `/api/v1/assets/upload-url` | 署名付きアップロード URL 発行 |
| POST | `/api/v1/assets/{id}/optimize` | 最適化ジョブ起動（通常は自動） |
| GET | `/api/v1/assets/{id}` | 最適化状況・variant 一覧 |
| GET/POST/PATCH/DELETE | `/api/v1/page-groups` | ページグループ CRUD |
| GET | `/api/v1/reports/summary` | 期間サマリ |
| GET | `/api/v1/reports/by-product` | 商品別 |
| GET | `/api/v1/reports/by-page` | ページグループ別（商品コードなしのページ） |
| GET | `/api/v1/reports/by-creative` | クリエイティブ別 |
| GET | `/api/v1/reports/timeseries` | 日次推移 |
| GET | `/api/v1/reports/export.csv` | CSV エクスポート |

### レポート API 共通パラメータ

```
?siteId=1
&from=2026-08-01&to=2026-08-11        // 期間指定
&campaignId=501                        // 任意
&productId=11                          // 任意
&pageGroupId=11                        // 任意
&creativeId=9002                       // 任意
&device=pc|sp|tablet                   // 任意
&orderType=first|all                   // 既定 first（定期の継続注文を除外）
&compare=previous                      // 前期間比較
&groupBy=date|product|page|creative|campaign|device
```

レスポンス例（`by-creative`）:

```jsonc
{
  "range": { "from": "2026-08-01", "to": "2026-08-11" },
  "totals": { "imps": 128400, "clicks": 5136, "ctr": 0.04,
              "cv": 412, "cvr": 0.0802, "revenue": 3820000 },
  "rows": [
    { "creativeId": 9001, "creativeName": "クーポンA",
      "imps": 64100, "clicks": 2884, "ctr": 0.045,
      "cvClick": 231, "cvView": 18, "cv": 249, "cvr": 0.0863,
      "revenue": 2100000, "rpm": 32.8 }
  ]
}
```

## 3. エラー / レート制限

| コード | 意味 |
| --- | --- |
| 400 | パラメータ不正 |
| 401 / 403 | 未認証 / 権限不足・許可ホスト外 |
| 409 | publish の競合（configVersion 不一致） |
| 413 | 画像サイズ超過（原本 10MB 上限） |
| 429 | レート制限（計測は site 単位 1,000 req/sec、管理 API は 60 req/min） |
