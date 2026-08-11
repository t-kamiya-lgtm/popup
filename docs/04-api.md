# 04. API 仕様

## 1. 配信系（パブリック / CDN・Edge）

### 1.1 配信設定取得

```
GET https://cdn.popup.example.com/c/{sitePublicId}.json
Cache-Control: public, max-age=60, stale-while-revalidate=600
```

レスポンス:

```jsonc
{
  "v": 128,                       // configVersion
  "site": { "id": "SITE_XXXX", "tz": "Asia/Tokyo" },
  "endpoints": { "decide": "https://edge.popup.example.com/d",
                 "collect": "https://edge.popup.example.com/e" },
  "pageGroups": [
    { "id": 11, "match": "prefix", "pattern": "/products/1001", "priority": 10 }
  ],
  "campaigns": [
    {
      "id": 501,
      "priority": 100,
      "period": { "from": "2026-08-01T00:00:00+09:00", "to": null },
      "targets": {
        "include": [{ "match": "prefix", "pattern": "/products/" }],
        "exclude": [{ "match": "contains", "pattern": "/cart" }]
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
- サイズが 100KB を超える規模になったらページグループ単位でシャーディングする

### 1.2 配信決定（均等ローテーション）

```
GET /d?s={sitePublicId}&c={campaignId}&v={visitorId}&cv={configVersion}
```

```jsonc
{ "creativeId": 9002, "slot": "a1b2", "holdout": false }
```

- Edge の Redis で `INCR rr:{campaignId}` → `index = counter % activeCreativeCount`
  （weight 指定時は累積重みテーブルで解決）
- 同一 visitor には**セッション中は同じクリエイティブ**を返す（sticky, TTL 30 分）
- `holdout` が true の場合、SDK は表示せず `holdout` イベントのみ送信
- タイムアウト 300ms。失敗時は SDK が乱択にフォールバック（統計上ほぼ均等）

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
      "pg": 11, "pc": "1001",           // pageGroupId / productCode
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
  "revenue": 5400, "currency": "JPY",
  "touch": { "cid": 501, "crid": 9002, "type": "click", "ts": 1786490000000 }
}
```

- 応答は常に `204 No Content`（レスポンスボディ無しで最速）
- サーバ側検証: `Origin` が `sites.allowed_hosts` に含まれるか、`ts` が ±10 分以内か
- `revenue` はクライアント値のため、金額は参考値である旨を管理画面に明記（厳密値が要る場合は S2S CV API を利用）

### 1.4 S2S コンバージョン API（任意 / 精度重視オプション）

```
POST /api/v1/conversions
Authorization: Bearer {siteApiKey}
```

```jsonc
{ "orderId": "EC-20260811-0001", "visitorId": "v_abc",
  "occurredAt": "2026-08-11T12:00:00+09:00", "revenue": 5400 }
```

サーバ側で `visitorId` の直近接触を検索してアトリビューションを付与。
ブラウザ CV と `orderId` で重複排除する。

## 2. 管理 API（認証必須 / REST）

| メソッド | パス | 概要 |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | ログイン（Cookie セッション） |
| GET/POST | `/api/v1/sites` | サイト一覧 / 作成 |
| GET | `/api/v1/sites/{id}/tag` | 設置タグのスニペット取得 |
| GET/POST/PATCH/DELETE | `/api/v1/campaigns` | キャンペーン CRUD |
| POST | `/api/v1/campaigns/{id}/publish` | 設定を CDN へ publish |
| GET/POST/PATCH/DELETE | `/api/v1/creatives` | クリエイティブ CRUD |
| POST | `/api/v1/assets/upload-url` | 署名付きアップロード URL 発行 |
| POST | `/api/v1/assets/{id}/optimize` | 最適化ジョブ起動（通常は自動） |
| GET | `/api/v1/assets/{id}` | 最適化状況・variant 一覧 |
| GET/POST/PATCH/DELETE | `/api/v1/page-groups` | ページグループ CRUD |
| GET | `/api/v1/reports/summary` | 期間サマリ |
| GET | `/api/v1/reports/by-page` | ページ（商品）別 |
| GET | `/api/v1/reports/by-creative` | クリエイティブ別 |
| GET | `/api/v1/reports/timeseries` | 日次推移 |
| GET | `/api/v1/reports/export.csv` | CSV エクスポート |

### レポート API 共通パラメータ

```
?siteId=1
&from=2026-08-01&to=2026-08-11        // 期間指定
&campaignId=501                        // 任意
&pageGroupId=11                        // 任意
&creativeId=9002                       // 任意
&device=pc|sp|tablet                   // 任意
&groupBy=date|page|creative|campaign|device
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
