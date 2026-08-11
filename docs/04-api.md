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
        "productCodes": { "include": ["1001", "1002"], "exclude": [] },
        "urls": {
          "include": [{ "match": "prefix", "pattern": "/lp/" }],
          "exclude": [{ "match": "contains", "pattern": "/cart" }]
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
      "url": "https://shop.example.com/products/1001?utm_source=mail",
      "pc": "1001",                     // productCode（タグから受領）
      "pn": "定期コースA",               // productName（初回受信時に自動登録）
      "dev": "sp", "pos": "center", "trg": "exit_back",
      "vid": "v_abc", "sesid": "s_def"
    }
  ]
}
```

CV イベントのみ追加フィールド:

```jsonc
{
  "t": "cv",
  "orderId": "EC-20260811-0001",
  "orderType": "first",              // 'first' | 'recurring'（既定は first のみ CV 計上）
  "planType": "subscription",        // 'subscription' | 'onetime'
  "revenue": 5400, "currency": "JPY",
  "touch": { "cid": 501, "crid": 9002, "type": "click", "ts": 1786490000000,
             "tok": "MjAyNjA4MTF8OTAwMnw5ZjJhLi4u" }   // pz_t 由来の署名
}
```

- 応答は常に `204 No Content`（レスポンスボディ無しで最速）
- サーバ側検証:
  - `Origin` が `sites.allowed_hosts` / `cart_hosts` に含まれるか
  - `ts` が ±10 分以内か（cv の `touch.ts` は CV ウィンドウ内か）
  - `touch.tok` の HMAC 署名が `sites.signing_key` で検証できるか（別ドメイン CV の改ざん防止）
- `revenue` はクライアント値のため参考値である旨を管理画面に明記（厳密値が要る場合は S2S CV API）

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
スマレジ・リピートのサンクスページに JS タグを設置できない場合の主経路になります。

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
