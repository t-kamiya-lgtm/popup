"use client";

import { useEffect, useState } from "react";

interface PopupLink {
  type: "campaign" | "campaign_list" | "none";
  editUrl?: string;
  reportUrl?: string;
}
interface Lp {
  id: number;
  productCode: string;
  itemName: string;
  lpName: string;
  url: string;
  topImageUrl: string | null;
  deliveryStatus: "active" | "paused";
  slotCount: number;
  activeCreativeCount: number;
  hasPausedCreative: boolean;
  popupLink: PopupLink;
}

interface CreativeDetail {
  id: number;
  name: string;
  status: "active" | "paused";
  weightPercent: number;
  isOriginal: boolean;
  imageUrl: string | null;
}
interface SlotDetail {
  id: number;
  slotKey: "a" | "b";
  label: string;
  creatives: CreativeDetail[];
}

function statusBadge(lp: Lp) {
  if (lp.deliveryStatus === "paused") return { label: "全停止", color: "#999" };
  if (lp.hasPausedCreative) return { label: "一部停止", color: "#b8860b" };
  return { label: "配信中", color: "#2a7" };
}

export function LpsPanel({ canEdit }: { canEdit: boolean }) {
  const [lps, setLps] = useState<Lp[] | null>(null);
  const [query, setQuery] = useState("");
  const [showPaused, setShowPaused] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, SlotDetail[] | "loading">>({});
  const [showNewForm, setShowNewForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ productCode: "", itemName: "", lpName: "", url: "" });

  async function load() {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (showPaused) params.set("showPaused", "1");
    const res = await fetch(`/api/v1/lps?${params.toString()}`);
    if (res.ok) setLps((await res.json()).lps);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, showPaused]);

  async function toggleExpand(lpId: number) {
    if (expanded[lpId]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[lpId];
        return next;
      });
      return;
    }
    setExpanded((prev) => ({ ...prev, [lpId]: "loading" }));
    const res = await fetch(`/api/v1/lps/${lpId}`);
    if (res.ok) {
      const { slots } = await res.json();
      setExpanded((prev) => ({ ...prev, [lpId]: slots }));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/lps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "作成に失敗しました");
        return;
      }
      setForm({ productCode: "", itemName: "", lpName: "", url: "" });
      setShowNewForm(false);
      await load();
      window.location.href = `/lps/${body.id}`;
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="品番・アイテム名・LP名で絞り込み"
          style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        />
        <label style={{ fontSize: 13, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} /> 配信停止中も表示
        </label>
        {canEdit && (
          <button type="button" onClick={() => setShowNewForm((v) => !v)}>
            + 新規LP登録
          </button>
        )}
      </div>

      {showNewForm && (
        <form
          onSubmit={handleCreate}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, border: "1px solid #ddd", borderRadius: 6, padding: 16, marginBottom: 16 }}
        >
          <input
            required
            placeholder="品番"
            value={form.productCode}
            onChange={(e) => setForm({ ...form, productCode: e.target.value })}
            style={{ padding: 8 }}
          />
          <input
            required
            placeholder="アイテム名"
            value={form.itemName}
            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
            style={{ padding: 8 }}
          />
          <input
            required
            placeholder="LP名"
            value={form.lpName}
            onChange={(e) => setForm({ ...form, lpName: e.target.value })}
            style={{ padding: 8 }}
          />
          <input
            required
            type="url"
            placeholder="LPのURL（https://...）"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            style={{ padding: 8 }}
          />
          <div style={{ gridColumn: "1 / -1" }}>
            {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}
            <button type="submit" disabled={creating}>
              {creating ? "登録中..." : "登録する"}
            </button>
          </div>
        </form>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8, width: 48 }}></th>
            <th style={{ padding: 8, width: 48 }}></th>
            <th style={{ padding: 8 }}>品番</th>
            <th style={{ padding: 8 }}>アイテム名</th>
            <th style={{ padding: 8 }}>LP名</th>
            <th style={{ padding: 8 }}>状態</th>
            <th style={{ padding: 8 }}>入稿数</th>
          </tr>
        </thead>
        <tbody>
          {lps?.map((lp) => {
            const badge = statusBadge(lp);
            const grey = lp.deliveryStatus === "paused";
            const detail = expanded[lp.id];
            return (
              <>
                <tr key={lp.id} style={{ borderBottom: "1px solid #eee", opacity: grey ? 0.5 : 1 }}>
                  <td style={{ padding: 8 }}>
                    <button type="button" onClick={() => toggleExpand(lp.id)} style={{ fontSize: 12 }}>
                      {detail ? "▲" : "▼"}
                    </button>
                  </td>
                  <td style={{ padding: 8 }}>
                    {lp.topImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lp.topImageUrl} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, background: "#eee", borderRadius: 4 }} />
                    )}
                  </td>
                  <td style={{ padding: 8 }}>{lp.productCode}</td>
                  <td style={{ padding: 8 }}>{lp.itemName}</td>
                  <td style={{ padding: 8 }}>
                    <a href={`/lps/${lp.id}`}>{lp.lpName}</a>
                    {lp.popupLink.type !== "none" && (
                      <a
                        href={lp.popupLink.editUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={lp.popupLink.type === "campaign" ? "ポップアップツールの編集画面を開く" : "ポップアップツールのキャンペーン一覧を開く（複数該当）"}
                        style={{ marginLeft: 6, fontSize: 11, textDecoration: "none" }}
                      >
                        🅿️
                      </a>
                    )}
                  </td>
                  <td style={{ padding: 8, color: badge.color }}>{badge.label}</td>
                  <td style={{ padding: 8 }}>{lp.activeCreativeCount}</td>
                </tr>
                {detail && (
                  <tr key={`${lp.id}-detail`}>
                    <td colSpan={7} style={{ padding: "0 8px 12px 48px", background: "#fafafa" }}>
                      {detail === "loading" ? (
                        <p style={{ fontSize: 13, color: "#888" }}>読み込み中...</p>
                      ) : (
                        detail.map((slot) => (
                          <div key={slot.id} style={{ marginTop: 8 }}>
                            <strong style={{ fontSize: 13 }}>
                              スロット{slot.slotKey.toUpperCase()}
                              {slot.label ? `（${slot.label}）` : ""}
                            </strong>
                            <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                              {slot.creatives
                                .filter((c) => c.status === "active")
                                .map((c) => (
                                  <div key={c.id} style={{ textAlign: "center", fontSize: 12 }}>
                                    {c.imageUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={c.imageUrl} alt={c.name} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                                    )}
                                    <div>{c.name}</div>
                                    <div style={{ color: "#666" }}>{c.weightPercent}%</div>
                                  </div>
                                ))}
                              {slot.creatives.filter((c) => c.status === "active").length === 0 && (
                                <span style={{ color: "#888" }}>アクティブなクリエイティブがありません（元画像100%配信中）</span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
          {lps?.length === 0 && (
            <tr>
              <td colSpan={7} style={{ padding: 16, color: "#888" }}>
                該当するLPがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
