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
  const [bandFilter, setBandFilter] = useState<{ lpId: number; lpLabel: string; creativeIds: number[] } | null>(null);
  const [report, setReport] = useState<LpReport[] | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  function buildParams() {
    const params = new URLSearchParams();
    if (bandFilter) {
      params.set("lpIds", String(bandFilter.lpId));
      params.set("creativeIds", bandFilter.creativeIds.join(","));
    } else {
      if (itemName) params.set("itemName", itemName);
      if (lpName) params.set("lpName", lpName);
    }
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
  }, [bandFilter]);

  function handleExport() {
    window.location.href = `/api/v1/reports/export?${buildParams().toString()}`;
  }

  function applyBand(lpId: number, lpLabel: string, from: string, to: string, creativeIds: number[]) {
    setFrom(from);
    setTo(to);
    setBandFilter({ lpId, lpLabel, creativeIds });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <input
          placeholder="アイテム名で絞り込み"
          value={itemName}
          disabled={!!bandFilter}
          onChange={(e) => setItemName(e.target.value)}
          style={{ padding: 6 }}
        />
        <input
          placeholder="LP名で絞り込み"
          value={lpName}
          disabled={!!bandFilter}
          onChange={(e) => setLpName(e.target.value)}
          style={{ padding: 6 }}
        />
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

      {bandFilter && (
        <div style={{ fontSize: 13, background: "#fff8e1", padding: "6px 10px", borderRadius: 4, marginBottom: 8, display: "inline-block" }}>
          カレンダー選択中: {bandFilter.lpLabel}（{from} 〜 {to}）
          <button type="button" onClick={() => setBandFilter(null)} style={{ marginLeft: 8, fontSize: 12 }}>
            解除
          </button>
        </div>
      )}

      <CalendarSearch onSelectBand={applyBand} />

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

interface LpOption {
  id: number;
  productCode: string;
  itemName: string;
  lpName: string;
}
interface BandCreative {
  id: number;
  name: string;
  imageUrl: string | null;
}
interface Band {
  from: string;
  to: string;
  slotA: BandCreative[];
  slotB: BandCreative[];
}

const BAND_COLORS = ["#cfe8ff", "#ffe8cf", "#d9f5d0", "#f5d0e8", "#e0d0f5", "#f5f0d0"];

function CalendarSearch({
  onSelectBand,
}: {
  onSelectBand: (lpId: number, lpLabel: string, from: string, to: string, creativeIds: number[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [lps, setLps] = useState<LpOption[] | null>(null);
  const [selectedLpId, setSelectedLpId] = useState<number | null>(null);
  const [bands, setBands] = useState<Band[] | null>(null);

  useEffect(() => {
    if (expanded && !lps) {
      fetch("/api/v1/lps?showPaused=1")
        .then((r) => r.json())
        .then((body) => setLps(body.lps));
    }
  }, [expanded, lps]);

  useEffect(() => {
    if (!selectedLpId) return;
    setBands(null);
    fetch(`/api/v1/lps/${selectedLpId}/timeline`)
      .then((r) => r.json())
      .then((body) => setBands(body.bands));
  }, [selectedLpId]);

  return (
    <div style={{ marginBottom: 16 }}>
      <button type="button" onClick={() => setExpanded((v) => !v)} style={{ fontSize: 13 }}>
        {expanded ? "▲" : "▼"} カレンダー検索（配信構成が変わった期間で絞り込み）
      </button>
      {expanded && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginTop: 8 }}>
          <select value={selectedLpId ?? ""} onChange={(e) => setSelectedLpId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">LPを選択...</option>
            {lps?.map((lp) => (
              <option key={lp.id} value={lp.id}>
                {lp.lpName}（{lp.itemName}）
              </option>
            ))}
          </select>

          {selectedLpId && bands === null && <p style={{ fontSize: 13, color: "#888" }}>読み込み中...</p>}
          {selectedLpId && bands && bands.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", width: "100%", height: 32, borderRadius: 4, overflow: "hidden" }}>
                {bands.map((band, i) => {
                  const days = (new Date(band.to).getTime() - new Date(band.from).getTime()) / 86400000 + 1;
                  const lpLabel = lps?.find((l) => l.id === selectedLpId)?.lpName ?? "";
                  const ids = [...band.slotA, ...band.slotB].map((c) => c.id);
                  return (
                    <button
                      key={i}
                      type="button"
                      title={`${band.from} 〜 ${band.to}: ${[...band.slotA, ...band.slotB].map((c) => c.name).join(" / ")}`}
                      onClick={() => onSelectBand(selectedLpId, lpLabel, band.from, band.to, ids)}
                      style={{
                        flexGrow: days,
                        flexBasis: 0,
                        background: BAND_COLORS[i % BAND_COLORS.length],
                        border: "none",
                        borderRight: "1px solid #fff",
                        cursor: "pointer",
                        fontSize: 10,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", marginTop: 2 }}>
                <span>{bands[0].from}</span>
                <span>{bands[bands.length - 1].to}</span>
              </div>
              <p style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                帯にカーソルを合わせると期間中の構成が表示されます。クリックするとその期間・その構成のみでレポートを絞り込みます。
              </p>
            </div>
          )}
          {selectedLpId && bands && bands.length === 0 && (
            <p style={{ fontSize: 13, color: "#888" }}>この期間の配信履歴がありません。</p>
          )}
        </div>
      )}
    </div>
  );
}
