"use client";

import { useEffect, useState } from "react";

interface Creative {
  id: number;
  name: string;
  status: "active" | "paused";
  weightPercent: number;
  isOriginal: boolean;
  isLocked: boolean;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
}
interface Slot {
  id: number;
  slotKey: "a" | "b";
  label: string;
  originalImageUrl: string;
  optimizationMode: "equal" | "auto";
  creatives: Creative[];
}
interface Lp {
  id: number;
  productCode: string;
  itemName: string;
  lpName: string;
  url: string;
  topImageUrl: string | null;
  deliveryStatus: "active" | "paused";
}
interface HistoryEvent {
  eventType: string;
  slotKey: string;
  creativeName: string;
  weightBefore: number | null;
  weightAfter: number | null;
  actorEmail: string;
  occurredAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  created: "作成",
  activated: "配信再開",
  paused: "配信停止",
  weight_changed: "表示率変更",
  locked: "手動固定",
  unlocked: "手動固定を解除",
  optimized: "自動最適化",
};

export function LpDetailPanel({ lpId, canEdit }: { lpId: number; canEdit: boolean }) {
  const [lp, setLp] = useState<Lp | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/lps/${lpId}`);
    if (res.ok) {
      const body = await res.json();
      setLp(body.lp);
      setSlots(body.slots);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  async function loadHistory() {
    const res = await fetch(`/api/v1/lps/${lpId}/history`);
    if (res.ok) setHistory((await res.json()).events);
  }

  async function toggleDeliveryStatus() {
    if (!lp) return;
    const next = lp.deliveryStatus === "active" ? "paused" : "active";
    const res = await fetch(`/api/v1/lps/${lpId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryStatus: next }),
    });
    if (res.ok) await load();
  }

  if (!lp) return <p>読み込み中...</p>;

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL ?? "";
  const slotOriginalAttrs = slots
    .map((s) => ` data-original-${s.slotKey}="${escapeHtmlAttr(s.originalImageUrl)}"`)
    .join("");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 4 }}>{lp.lpName}</h1>
          <p style={{ color: "#666", fontSize: 13 }}>
            品番: {lp.productCode} / アイテム名: {lp.itemName}
          </p>
          <p style={{ fontSize: 13 }}>
            <a href={lp.url} target="_blank" rel="noreferrer">
              {lp.url}
            </a>
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={toggleDeliveryStatus}>
            {lp.deliveryStatus === "active" ? "このLPを配信停止" : "このLPを配信再開"}
          </button>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={() => setShowTags((v) => !v)}>
          {showTags ? "▲" : "▼"} 設置タグ
        </button>
        {showTags && (
          <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginTop: 8, fontSize: 13 }}>
            <p>LPに設置する差し替えタグ（1本）:</p>
            <p style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
              設置場所: LPページの <code>&lt;head&gt;</code> 直後（画像がブラウザに描画される前に実行させるため、
              なるべく早い位置に置いてください）。元画像のURLをタグ自体に含めているのは、差し替え判定が終わるまで
              元画像を一瞬も表示させない（ちらつき防止）ためです。
            </p>
            <TagBox
              text={`<script async src="${appBaseUrl}/tag.js" data-lp-id="${lp.id}"${slotOriginalAttrs}></script>`}
            />
            <p style={{ marginTop: 12 }}>サンクスページに設置するCVタグ（2本セット）:</p>
            <p style={{ fontSize: 12, color: "#666", marginTop: 2, fontWeight: "bold" }}>
              全LP共通のタグです。サイト全体で1回だけ設置すればOKで、LPごとに設置し直す必要はありません
              （どのLPでのCVかは、サンクスページ側でこのLP専用に設定する必要はなく、収集側でセッションIDから自動的に判定します）。
            </p>
            <p style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
              設置場所: カート管理画面の「アフィリエイト登録・編集」（出力画面: 注文完了画面、出力方式: タグ方式(body内)、
              流入元URL条件は指定不要）。
              汎用の「HTML自由入力欄」（例: <code>&lt;/body&gt;</code>直前欄）には差し込みタグの展開が効かないことがあるため注意してください。
              1本目の <code>{"{注文番号}"}</code> 等はカート側の差し込みタグなので、そのまま貼り付けてください（値を書き換える必要はありません）。
              シングルクォート（<code>&#39;</code>）で囲む書き方にしているのは、カート側の差し込みタグ展開が
              この引用符の書き方でのみ有効なため（ダブルクォートや属性値では展開されません）。
            </p>
            <TagBox
              text={`<script>\n  var lpabOrderId = '{注文番号}';\n  var lpabRevenue = {注文金額合計(税込)};\n  window.__lpabCv = { orderId: lpabOrderId, revenue: lpabRevenue };\n</script>\n<script async src="${appBaseUrl}/cv-tag.js"></script>`}
            />
            <div style={{ marginTop: 12 }}>
              <TagCheckPanel lpId={lp.id} />
            </div>
          </div>
        )}
      </div>

      {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{error}</p>}

      {slots.map((slot) => (
        <SlotPanel key={slot.id} slot={slot} canEdit={canEdit} onChange={load} onError={setError} />
      ))}

      {canEdit && slots.length < 2 && <NewSlotForm lpId={lpId} taken={slots.map((s) => s.slotKey)} onCreated={load} onError={setError} />}

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={() => {
            setShowHistory((v) => !v);
            if (!history) void loadHistory();
          }}
        >
          {showHistory ? "▲" : "▼"} 変更履歴
        </button>
        {showHistory && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: 4 }}>日時</th>
                <th style={{ padding: 4 }}>スロット</th>
                <th style={{ padding: 4 }}>クリエイティブ</th>
                <th style={{ padding: 4 }}>操作</th>
                <th style={{ padding: 4 }}>表示率</th>
                <th style={{ padding: 4 }}>操作者</th>
              </tr>
            </thead>
            <tbody>
              {history?.map((h, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 4 }}>{new Date(h.occurredAt).toLocaleString("ja-JP")}</td>
                  <td style={{ padding: 4 }}>{h.slotKey.toUpperCase()}</td>
                  <td style={{ padding: 4 }}>{h.creativeName}</td>
                  <td style={{ padding: 4 }}>{EVENT_LABEL[h.eventType] ?? h.eventType}</td>
                  <td style={{ padding: 4 }}>
                    {h.weightBefore !== null && h.weightAfter !== null ? `${h.weightBefore}% → ${h.weightAfter}%` : "—"}
                  </td>
                  <td style={{ padding: 4 }}>{h.actorEmail}</td>
                </tr>
              ))}
              {history?.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 8, color: "#888" }}>
                    履歴はまだありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function TagBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
      <pre style={{ background: "#f4f4f4", padding: 8, borderRadius: 4, flex: 1, overflowX: "auto", margin: 0, fontFamily: "monospace" }}>{text}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setCopied(true);
        }}
      >
        {copied ? "コピー済み" : "コピー"}
      </button>
    </div>
  );
}

interface TagCheckResult {
  fetchOk: boolean;
  fetchError: string | null;
  tagFound: boolean;
  lpIdMatches: boolean;
  impressionsLast24h: number;
}

function TagCheckPanel({ lpId }: { lpId: number }) {
  const [result, setResult] = useState<TagCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  async function runCheck() {
    setChecking(true);
    try {
      const res = await fetch(`/api/v1/lps/${lpId}/tag-check`);
      if (res.ok) setResult(await res.json());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={runCheck} disabled={checking}>
        {checking ? "確認中..." : "タグ設置状況を確認"}
      </button>
      {result && (
        <ul style={{ fontSize: 12, marginTop: 8, paddingLeft: 16 }}>
          <li style={{ color: result.fetchOk ? "#2a7" : "crimson" }}>
            LPページの取得: {result.fetchOk ? "成功" : `失敗（${result.fetchError}）`}
          </li>
          <li style={{ color: result.lpIdMatches ? "#2a7" : result.tagFound ? "#b8860b" : "crimson" }}>
            差し替えタグの設置:{" "}
            {result.lpIdMatches ? "設置済み" : result.tagFound ? "タグはあるがLP IDが一致しません" : "見つかりません"}
          </li>
          <li style={{ color: result.impressionsLast24h > 0 ? "#2a7" : "#b8860b" }}>
            過去24時間のimp受信: {result.impressionsLast24h}件
            {result.impressionsLast24h === 0 && "（タグはあっても計測が届いていない可能性があります）"}
          </li>
        </ul>
      )}
    </div>
  );
}

function SlotPanel({
  slot,
  canEdit,
  onChange,
  onError,
}: {
  slot: Slot;
  canEdit: boolean;
  onChange: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setUploading(true);
    onError(null);
    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("image", file);
      const res = await fetch(`/api/v1/slots/${slot.id}/creatives`, { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "登録に失敗しました");
        return;
      }
      if (body.warning) onError(body.warning.message);
      setName("");
      setFile(null);
      await onChange();
    } finally {
      setUploading(false);
    }
  }

  async function updateCreative(id: number, patch: Record<string, unknown>) {
    const res = await fetch(`/api/v1/creatives/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      onError(body.error ?? "更新に失敗しました");
      return;
    }
    await onChange();
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 16, marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginBottom: 8 }}>
        スロット{slot.slotKey.toUpperCase()}
        {slot.label ? `（${slot.label}）` : ""} — 差し替え対象URL:{" "}
        <code style={{ fontSize: 12 }}>{slot.originalImageUrl}</code>
      </h2>

      <OptimizationSettings slotId={slot.id} mode={slot.optimizationMode} canEdit={canEdit} onChange={onChange} onError={onError} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
        {slot.creatives.map((c) => (
          <div key={c.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, opacity: c.status === "paused" ? 0.5 : 1 }}>
            {c.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.imageUrl} alt={c.name} style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 4 }} />
            )}
            <div style={{ fontSize: 13, marginTop: 4, fontWeight: "bold" }}>
              {c.name} {c.isOriginal && <span style={{ color: "#888", fontWeight: "normal" }}>（元画像）</span>}
            </div>
            <WeightEditor creative={c} canEdit={canEdit} onSave={(w) => updateCreative(c.id, { weightPercent: w })} />
            {c.isLocked && <div style={{ fontSize: 11, color: "#b8860b" }}>手動固定中</div>}
            {canEdit && !c.isOriginal && (
              <button
                type="button"
                onClick={() => updateCreative(c.id, { status: c.status === "active" ? "paused" : "active" })}
                style={{ fontSize: 12, marginTop: 4 }}
              >
                {c.status === "active" ? "配信停止" : "配信再開"}
              </button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <form onSubmit={handleUpload} style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <input placeholder="パターン名（例: Bパターン）" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 6 }} />
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="submit" disabled={uploading || !file || !name.trim()}>
            {uploading ? "登録中..." : "パターンを追加"}
          </button>
        </form>
      )}
    </div>
  );
}

function OptimizationSettings({
  slotId,
  mode,
  canEdit,
  onChange,
  onError,
}: {
  slotId: number;
  mode: "equal" | "auto";
  canEdit: boolean;
  onChange: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<{
    minImpressions: number;
    minConversions: number;
    floorMode: "equal_share" | "fixed_percent";
    floorPercent: number | null;
    lastRunAt: string | null;
  } | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/slots/${slotId}`);
    if (res.ok) setSettings(await res.json());
  }

  useEffect(() => {
    if (expanded) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/v1/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      onError(errBody.error ?? "更新に失敗しました");
      return;
    }
    await load();
    await onChange();
  }

  return (
    <div style={{ fontSize: 13 }}>
      <button type="button" onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12 }}>
        {expanded ? "▲" : "▼"} 表示率の配分方式: {mode === "auto" ? "自動最適化（CVRベース・日次）" : "均等割り"}
      </button>
      {expanded && (
        <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, marginTop: 4 }}>
          {canEdit && (
            <label>
              <input
                type="checkbox"
                checked={mode === "auto"}
                onChange={(e) => patch({ optimizationMode: e.target.checked ? "auto" : "equal" })}
              />{" "}
              自動最適化を有効にする（配信停止フラグは常に優先。手動で表示率を変更したパターンは次回以降の自動最適化から除外されます）
            </label>
          )}
          {mode === "auto" && settings && (
            <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label>
                最低imp数:{" "}
                <input
                  type="number"
                  disabled={!canEdit}
                  defaultValue={settings.minImpressions}
                  onBlur={(e) => patch({ minImpressions: Number(e.target.value) })}
                  style={{ width: 80 }}
                />
              </label>
              <label>
                最低CV数:{" "}
                <input
                  type="number"
                  disabled={!canEdit}
                  defaultValue={settings.minConversions}
                  onBlur={(e) => patch({ minConversions: Number(e.target.value) })}
                  style={{ width: 80 }}
                />
              </label>
              <span style={{ color: "#666" }}>
                下限フロア: {settings.floorMode === "equal_share" ? "均等割り相当" : `${settings.floorPercent ?? "-"}%`}
              </span>
              <span style={{ color: "#666" }}>
                最終実行: {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString("ja-JP") : "未実行"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeightEditor({ creative, canEdit, onSave }: { creative: Creative; canEdit: boolean; onSave: (w: number) => void }) {
  const [value, setValue] = useState(String(creative.weightPercent));
  const [editing, setEditing] = useState(false);

  if (!canEdit) return <div style={{ fontSize: 13, color: "#666" }}>{creative.weightPercent}%</div>;

  return editing ? (
    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 56, padding: 2 }}
      />
      <button
        type="button"
        onClick={() => {
          onSave(Number(value));
          setEditing(false);
        }}
        style={{ fontSize: 11 }}
      >
        保存
      </button>
    </div>
  ) : (
    <div
      style={{ fontSize: 13, color: "#666", cursor: "pointer" }}
      onClick={() => {
        setValue(String(creative.weightPercent));
        setEditing(true);
      }}
      title="クリックして手動変更"
    >
      {creative.weightPercent}%（編集）
    </div>
  );
}

function NewSlotForm({
  lpId,
  taken,
  onCreated,
  onError,
}: {
  lpId: number;
  taken: Array<"a" | "b">;
  onCreated: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const available = (["a", "b"] as const).filter((k) => !taken.includes(k));
  const [slotKey, setSlotKey] = useState<"a" | "b">(available[0] ?? "a");
  const [label, setLabel] = useState("");
  const [originalImageUrl, setOriginalImageUrl] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    onError(null);
    try {
      const res = await fetch(`/api/v1/lps/${lpId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, label, originalImageUrl }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(body.error ?? "作成に失敗しました");
        return;
      }
      setLabel("");
      setOriginalImageUrl("");
      await onCreated();
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ border: "1px dashed #ccc", borderRadius: 6, padding: 16, marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
    >
      <strong style={{ fontSize: 13 }}>差し替え箇所を追加:</strong>
      <select value={slotKey} onChange={(e) => setSlotKey(e.target.value as "a" | "b")}>
        {available.map((k) => (
          <option key={k} value={k}>
            スロット{k.toUpperCase()}
          </option>
        ))}
      </select>
      <input placeholder="ラベル（任意、例: ファーストビュー画像）" value={label} onChange={(e) => setLabel(e.target.value)} style={{ padding: 6, flex: 1 }} />
      <input
        required
        placeholder="既存LP上の画像URL"
        value={originalImageUrl}
        onChange={(e) => setOriginalImageUrl(e.target.value)}
        style={{ padding: 6, flex: 2 }}
      />
      <button type="submit" disabled={creating}>
        {creating ? "作成中..." : "追加"}
      </button>
    </form>
  );
}
