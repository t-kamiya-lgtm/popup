"use client";

import { useEffect, useState } from "react";
import { isSignificant, type CreativeStat } from "@/lib/significance";

interface SlotStat {
  slotKey: "a" | "b";
  label: string;
  creatives: CreativeStat[];
}
interface LpReport {
  lpId: number;
  productCode: string;
  itemName: string;
  lpName: string;
  slots: SlotStat[];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPanel() {
  const [itemName, setItemName] = useState("");
  const [lpName, setLpName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<LpReport[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  function buildParams() {
    const params = new URLSearchParams();
    if (itemName) params.set("itemName", itemName);
    if (lpName) params.set("lpName", lpName);
    if (from && to) {
      params.set("from", from);
      params.set("to", to);
    }
    return params;
  }

  async function load() {
    const res = await fetch(`/api/v1/reports?${buildParams().toString()}`);
    if (res.ok) {
      const body = await res.json();
      setReport(body.report);
      setRange({ from: body.from.slice(0, 10), to: body.to.slice(0, 10) });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExport() {
    window.location.href = `/api/v1/reports/export?${buildParams().toString()}`;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <input placeholder="アイテム名で絞り込み" value={itemName} onChange={(e) => setItemName(e.target.value)} style={{ padding: 6 }} />
        <input placeholder="LP名で絞り込み" value={lpName} onChange={(e) => setLpName(e.target.value)} style={{ padding: 6 }} />
        <label style={{ fontSize: 13 }}>
          期間:
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ marginLeft: 4 }} max={todayIso()} />
        </label>
        <span>〜</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} max={todayIso()} />
        <button type="button" onClick={load}>
          表示
        </button>
        <button type="button" onClick={handleExport}>
          CSVダウンロード
        </button>
      </div>

      {range && (
        <p style={{ fontSize: 13, color: "#666" }}>
          集計期間: {range.from} 〜 {range.to}（未指定の場合は当月）
        </p>
      )}

      {report === null ? (
        <p>読み込み中...</p>
      ) : report.length === 0 ? (
        <p style={{ color: "#888" }}>この期間・条件に該当する配信実績のあるLPがありません。</p>
      ) : (
        report.map((lp) => (
          <div key={lp.lpId} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16 }}>
              {lp.lpName}{" "}
              <span style={{ fontSize: 12, color: "#666", fontWeight: "normal" }}>
                （品番: {lp.productCode} / アイテム名: {lp.itemName}）
              </span>
            </h2>
            {lp.slots.map((slot) => {
              const original = slot.creatives.find((c) => c.isOriginal);
              return (
                <table key={slot.slotKey} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                      <th style={{ padding: 4 }} colSpan={2}>
                        スロット{slot.slotKey.toUpperCase()}
                        {slot.label ? `（${slot.label}）` : ""}
                      </th>
                      <th style={{ padding: 4 }}>imp</th>
                      <th style={{ padding: 4 }}>CV</th>
                      <th style={{ padding: 4 }}>CVR</th>
                      <th style={{ padding: 4 }}>売上</th>
                      <th style={{ padding: 4 }}>元画像との有意差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.creatives.map((c) => {
                      const sig = !c.isOriginal && original ? isSignificant(c, original) : null;
                      return (
                        <tr key={c.creativeId} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: 4, width: 40 }}>
                            {c.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }} />
                            )}
                          </td>
                          <td style={{ padding: 4 }}>
                            {c.creativeName}
                            {c.isOriginal && <span style={{ color: "#888" }}>（元画像）</span>}
                          </td>
                          <td style={{ padding: 4 }}>{c.imps}</td>
                          <td style={{ padding: 4 }}>{c.cv}</td>
                          <td style={{ padding: 4 }}>{c.cvr !== null ? `${c.cvr}%` : "—"}</td>
                          <td style={{ padding: 4 }}>{c.revenue.toLocaleString("ja-JP")}円</td>
                          <td style={{ padding: 4 }}>
                            {c.isOriginal ? (
                              "基準"
                            ) : sig === null ? (
                              <span style={{ color: "#888" }}>判定不可（サンプル不足）</span>
                            ) : sig ? (
                              <span style={{ color: "#2a7" }}>有意差あり</span>
                            ) : (
                              <span style={{ color: "#888" }}>有意差なし</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
