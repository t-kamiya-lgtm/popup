"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReportData } from "@/lib/reports";

type Preset = "today" | "yesterday" | "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

const PRESET_LABEL: Record<Preset, string> = {
  today: "今日",
  yesterday: "昨日",
  "7d": "過去7日",
  "30d": "過去30日",
  thisMonth: "今月",
  lastMonth: "先月",
  custom: "カスタム",
};

// `to` is exclusive throughout. Computed from the browser's local clock —
// fine for a Japan-only admin audience (see lib/reports.ts's own note on
// skipping stats_daily for a live query instead).
function rangeForPreset(preset: Preset): { from: Date; to: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  switch (preset) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -7), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -30), to: addDays(today, 1) };
    case "thisMonth":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
    case "lastMonth":
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    case "custom":
      return { from: today, to: addDays(today, 1) };
  }
}

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

export function ReportsPanel() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState(() => toDateInputValue(rangeForPreset("7d").from));
  const [customTo, setCustomTo] = useState(() => toDateInputValue(rangeForPreset("7d").to));
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset !== "custom") return rangeForPreset(preset);
    return { from: new Date(customFrom), to: new Date(customTo) };
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    fetch(`/api/v1/reports?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "取得に失敗しました");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  function handlePresetChange(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = rangeForPreset(p);
      setCustomFrom(toDateInputValue(r.from));
      setCustomTo(toDateInputValue(r.to));
    }
  }

  function handleExportCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push("サマリ");
    lines.push("表示回数,クリック数,CTR,CV数,CVR,売上");
    lines.push(
      [data.summary.imps, data.summary.clicks, pct(data.summary.ctr), data.summary.cvs, pct(data.summary.cvr), data.summary.revenue].join(",")
    );
    lines.push("");
    lines.push("ページ別");
    lines.push("ページグループ,imp,click,CTR");
    for (const p of data.pageGroups) lines.push([p.name, p.imps, p.clicks, pct(p.ctr)].join(","));
    lines.push("");
    lines.push("商品別");
    lines.push(`商品コード,商品名,CV(クリックスルー),CV(ビュースルー),売上`);
    for (const p of data.products) {
      lines.push([p.productCode ?? "", `"${p.productName}"`, p.cvClick, p.cvView, p.revenue].join(","));
    }
    lines.push("");
    lines.push("クリエイティブ別");
    lines.push("クリエイティブ,imp,click,CTR,CV,CVR,売上");
    for (const c of data.creatives) {
      lines.push([`"${c.name}"`, c.imps, c.clicks, pct(c.ctr), c.cvs, pct(c.cvr), c.revenue].join(","));
    }

    const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${toDateInputValue(range.from)}_${toDateInputValue(range.to)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {(Object.keys(PRESET_LABEL) as Preset[])
          .filter((p) => p !== "custom")
          .map((p) => (
            <button key={p} onClick={() => handlePresetChange(p)} disabled={preset === p}>
              {PRESET_LABEL[p]}
            </button>
          ))}
        <input
          type="date"
          value={customFrom}
          onChange={(e) => {
            setPreset("custom");
            setCustomFrom(e.target.value);
          }}
        />
        <span>〜</span>
        <input
          type="date"
          value={customTo}
          onChange={(e) => {
            setPreset("custom");
            setCustomTo(e.target.value);
          }}
        />
        <button onClick={handleExportCsv} disabled={!data} style={{ marginLeft: "auto" }}>
          CSV出力
        </button>
      </div>

      {loading && <p>読み込み中...</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 32 }}>
            <StatCard label="表示回数" value={data.summary.imps.toLocaleString("ja-JP")} />
            <StatCard label="クリック数" value={data.summary.clicks.toLocaleString("ja-JP")} />
            <StatCard label="CTR" value={pct(data.summary.ctr)} />
            <StatCard label="CV数" value={data.summary.cvs.toLocaleString("ja-JP")} />
            <StatCard label="CVR" value={pct(data.summary.cvr)} />
            <StatCard label="売上" value={yen(data.summary.revenue)} />
          </div>

          <Section title="ページ別（imp / click）">
            <Table
              head={["ページグループ", "imp", "click", "CTR"]}
              rows={data.pageGroups.map((p) => [p.name, p.imps.toLocaleString("ja-JP"), p.clicks.toLocaleString("ja-JP"), pct(p.ctr)])}
              empty="データがありません"
            />
          </Section>

          <Section title="商品別（実売上）">
            <p style={{ color: "#666", fontSize: 13 }}>
              商品はサンクスページのループタグから取得したコードで識別しているため、imp / click / CTR は持ちません。
            </p>
            <Table
              head={["商品コード", "商品名", "CV（クリックスルー）", "CV（ビュースルー）", "売上"]}
              rows={data.products.map((p) => [
                p.productCode ?? "—",
                p.productName,
                p.cvClick.toLocaleString("ja-JP"),
                p.cvView.toLocaleString("ja-JP"),
                yen(p.revenue),
              ])}
              empty="データがありません"
            />
          </Section>

          <Section title="クリエイティブ別">
            <Table
              head={["", "クリエイティブ", "imp", "click", "CTR", "CV", "CVR", "売上"]}
              rows={data.creatives.map((c) => [
                c.thumbnail ? (
                  <img key="thumb" src={c.thumbnail} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                ) : (
                  ""
                ),
                c.name,
                c.imps.toLocaleString("ja-JP"),
                c.clicks.toLocaleString("ja-JP"),
                pct(c.ctr),
                c.cvs.toLocaleString("ja-JP"),
                pct(c.cvr),
                yen(c.revenue),
              ])}
              empty="クリエイティブがありません"
            />
          </Section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
      <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p style={{ color: "#888" }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            {head.map((h, i) => (
              <th key={i} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
