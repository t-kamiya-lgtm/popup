"use client";

import { useState } from "react";

interface Props {
  sitePublicId: string;
  cdnBase: string;
}

export function TagsPanel({ sitePublicId, cdnBase }: Props) {
  const commonTag = `<script async src="${cdnBase}/t.js?sid=${sitePublicId}"></script>`;

  const cvTag = `<!-- 共通タグ（未設置なら先に設置） -->
<script async src="${cdnBase}/t.js?sid=${sitePublicId}"></script>

<!-- コンバージョンタグ -->
<script>
(function () {
  window.pqz = window.pqz || [];
  var orderId = '{注文番号}';
  // 未展開のまま（'{' が残る）なら送信しない
  if (!orderId || orderId.indexOf('{') !== -1) return;

  window.pqz.push(['conversion', {
    orderId: orderId,
    customerId: '{顧客ID}',
    revenueExTax: {注文金額合計(税別)},
    tax: {消費税},
    items: [
      {商品毎出力}{ code: '{商品コード}', qty: {注文個数}, revenueExTax: {商品代金合計(税別)} },{/商品毎出力}
    ]
  }]);
})();
</script>`;

  return (
    <div>
      <Section
        title="① 共通タグ"
        description="全ページの </head> 直前に設置してください（サンクスページも含む）。表示・計測トリガーの監視に使います。"
      >
        <CodeBlock code={commonTag} />
      </Section>

      <Section
        title="② コンバージョンタグ（サンクスページのみ）"
        description={
          <>
            サンクスページに、共通タグとあわせて設置してください。
            <code>{"{注文番号}"}</code> 等の <code>{"{ }"}</code> で囲まれた部分はスマレジEC・リピート側の差し込みタグです
            （このまま貼り付けてください。値を書き換える必要はありません）。
          </>
        }
      >
        <CodeBlock code={cvTag} />
      </Section>

      <Section title="設置後の確認" description="">
        <ul style={{ fontSize: 14, color: "#444", paddingLeft: 20 }}>
          <li>ページの表示崩れ・読み込み速度に影響がないか確認してください（共通タグは非同期読み込みです）</li>
          <li>テスト購入を1件行い、「実績レポート」に imp・click・CV が計上されることを確認してください</li>
          <li>商品別テーブルに「（商品明細が空だったCV）」が出る場合、{"{商品毎出力}"}タグの設置漏れの可能性があります</li>
        </ul>
        <p style={{ color: "#888", fontSize: 12 }}>
          設置状況を自動診断する「タグ設置チェッカー」（`docs/06-admin.md` 6章）は未実装です。
        </p>
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #eee" }}>
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      {description && <p style={{ color: "#666", fontSize: 13 }}>{description}</p>}
      {children}
    </section>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          background: "#1e1e1e",
          color: "#e6e6e6",
          padding: 16,
          borderRadius: 6,
          overflowX: "auto",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <code>{code}</code>
      </pre>
      <button onClick={handleCopy} style={{ position: "absolute", top: 8, right: 8 }}>
        {copied ? "コピーしました" : "コピー"}
      </button>
    </div>
  );
}
