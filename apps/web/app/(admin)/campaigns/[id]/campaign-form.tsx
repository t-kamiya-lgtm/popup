"use client";

import type { CreativeConfig, Device, PositionPc } from "@popup/shared";
import { useEffect, useMemo, useState } from "react";
import type { CampaignDetail } from "@/lib/campaigns";
import { normalizeUrlPattern } from "@/lib/url-pattern";
import { normalizeLinkUrl } from "@/lib/link-url";
import { ENLARGED_SCALE, PreviewPanel } from "./preview-panel";

interface UploadResponse {
  assetId: number;
  images: { pc: CreativeConfig["images"]["pc"]; sp: CreativeConfig["images"]["sp"] };
}

const POSITION_PC_OPTIONS: { value: PositionPc; label: string }[] = [
  { value: "bottom_right", label: "右下" },
  { value: "bottom_center", label: "下部中央" },
  { value: "bottom_left", label: "左下" },
  { value: "center", label: "画面中央" },
];

type Target = CampaignDetail["targets"][number];
type Creative = CampaignDetail["creatives"][number];

export function CampaignForm({ initial }: { initial: CampaignDetail }) {
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState(initial.status);
  const [brandId, setBrandId] = useState<number | null>(initial.brandId);
  const [brands, setBrands] = useState<{ id: number; name: string }[]>([]);
  const [priority, setPriority] = useState(initial.priority);
  const [holdoutRate, setHoldoutRate] = useState(initial.holdoutRate);
  const [devices, setDevices] = useState<string[]>(initial.devices);
  const [exitBack, setExitBack] = useState(initial.triggers.rules.some((r) => r.type === "exit_back"));
  const [dwell, setDwell] = useState(initial.triggers.rules.some((r) => r.type === "dwell"));
  const [dwellSeconds, setDwellSeconds] = useState(
    initial.triggers.rules.find((r) => r.type === "dwell")?.seconds ?? 60
  );
  const [triggerMode, setTriggerMode] = useState(initial.triggers.mode);
  const [frequency, setFrequency] = useState(initial.frequency);
  const [positionPc, setPositionPc] = useState<PositionPc>(initial.positionPc as PositionPc);
  const [overlay, setOverlay] = useState(initial.overlay);
  const [closeButton, setCloseButton] = useState(initial.closeButton);
  const [targets, setTargets] = useState<Target[]>(initial.targets);
  const [creatives, setCreatives] = useState<Creative[]>(initial.creatives);

  const [previewDevice, setPreviewDevice] = useState<Device>("pc");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/brands")
      .then((res) => (res.ok ? res.json() : { brands: [] }))
      .then((body) => setBrands(body.brands ?? []));
  }, []);

  async function handleImageUpload(i: number, file: File) {
    setUploadingIndex(i);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/assets", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(body.error ?? "アップロードに失敗しました");
        return;
      }
      const { assetId, images } = body as UploadResponse;
      updateCreative(i, {
        assetPcId: assetId,
        assetSpId: assetId,
        imagePc: images.pc,
        imageSp: images.sp,
      });
    } finally {
      setUploadingIndex(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const rules = [];
      if (exitBack) rules.push({ type: "exit_back" });
      if (dwell) rules.push({ type: "dwell", seconds: dwellSeconds });

      const normalizedTargets = targets
        .filter((t) => t.pattern.trim() !== "")
        .map((t) => ({ ...t, pattern: normalizeUrlPattern(t.pattern, t.matchType) }));
      setTargets(normalizedTargets);

      const normalizedCreatives = creatives
        .filter((c) => c.linkAction === "close" || c.linkUrl.trim() !== "")
        .map((c) => (c.linkAction === "close" ? c : { ...c, linkUrl: normalizeLinkUrl(c.linkUrl) }));
      setCreatives(normalizedCreatives);

      const res = await fetch(`/api/v1/campaigns/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          status,
          brandId,
          priority,
          holdoutRate,
          devices,
          triggers: { mode: triggerMode, rules },
          frequency,
          positionPc,
          positionSp: "center",
          overlay,
          closeButton,
          targets: normalizedTargets,
          creatives: normalizedCreatives,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "保存に失敗しました");
        return;
      }
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  const previewCreative: CreativeConfig | null = useMemo(() => {
    const c = creatives[previewIndex];
    if (!c) return null;
    return {
      id: c.id,
      weight: 1,
      linkUrl: c.linkUrl,
      linkTarget: c.linkTarget as "_self" | "_blank",
      linkAction: c.linkAction,
      alt: c.altText,
      images: {
        // Falls back to the same empty placeholder the live config JSON
        // serves for a creative with no uploaded image yet, so the
        // preview shows exactly what production would show: alt text only.
        pc: c.imagePc ?? { w: 380, h: 300, fallback: "" },
        sp: c.imageSp ?? { w: 320, h: 400, fallback: "" },
      },
    };
  }, [creatives, previewIndex]);

  return (
    <div style={{ maxWidth: 640 }}>
      <a href="/campaigns">← キャンペーン一覧</a>
      <h1 style={{ fontSize: 20 }}>キャンペーン編集</h1>

        <Section title="① 基本">
          <Field label="キャンペーン名">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="ステータス">
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={inputStyle}>
              <option value="draft">下書き</option>
              <option value="active">配信中</option>
              <option value="paused">停止</option>
              <option value="archived">アーカイブ</option>
            </select>
          </Field>
          <Field label="ブランド">
            <select
              value={brandId ?? ""}
              onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}
              style={inputStyle}
            >
              <option value="">未設定</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span style={{ marginLeft: 8, fontSize: 13, color: "#888" }}>
              <a href="/brands">ブランド管理</a>で追加できます
            </span>
          </Field>
          <Field label="優先度（数値が小さいほど優先）">
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
          <Field label="対照群比率（holdout）">
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={holdoutRate}
              onChange={(e) => setHoldoutRate(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
        </Section>

        <Section title="② 対象ページ（URLルール）">
          <p style={{ color: "#666", fontSize: 13 }}>
            商品コード指定はできません（`docs/09-cart-integration.md` 1.3
            の確認結果、ページ側に確実な商品コードが無いため）。
          </p>
          {initial.siteHost && (
            <p style={{ color: "#666", fontSize: 13 }}>
              各行の「プレビュー」は実際のページを新しいタブで開き、トリガー・表示回数上限・対照群を無視してポップアップを強制表示します（計測には含まれません）。
              未保存の変更（表示位置・クリエイティブなど）は反映されないため、確認前に一度保存してください。
            </p>
          )}
          {targets.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <select
                value={t.kind}
                onChange={(e) => updateTarget(i, { kind: e.target.value as Target["kind"] })}
                style={{ ...inputStyle, width: 90 }}
              >
                <option value="include">含める</option>
                <option value="exclude">除外</option>
              </select>
              <select
                value={t.matchType}
                onChange={(e) => updateTarget(i, { matchType: e.target.value as Target["matchType"] })}
                style={{ ...inputStyle, width: 100 }}
              >
                <option value="exact">完全一致</option>
                <option value="prefix">前方一致</option>
                <option value="contains">部分一致</option>
                <option value="regex">正規表現</option>
              </select>
              <input
                value={t.pattern}
                onChange={(e) => updateTarget(i, { pattern: e.target.value })}
                placeholder="/products/"
                style={{ ...inputStyle, flex: 1 }}
              />
              {previewUrl(t) && (
                <a href={previewUrl(t)!} target="_blank" rel="noopener noreferrer">
                  <button type="button">プレビュー</button>
                </a>
              )}
              <button onClick={() => setTargets(targets.filter((_, idx) => idx !== i))}>削除</button>
            </div>
          ))}
          <button onClick={() => setTargets([...targets, { kind: "exclude", matchType: "contains", pattern: "" }])}>
            ＋ ルールを追加
          </button>
        </Section>

        <Section title="③ 表示条件">
          <Field label="トリガー">
            <label style={checkboxLabel}>
              <input type="checkbox" checked={exitBack} onChange={(e) => setExitBack(e.target.checked)} />
              ブラウザバック時
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={dwell} onChange={(e) => setDwell(e.target.checked)} />
              訪問から
              <input
                type="number"
                value={dwellSeconds}
                onChange={(e) => setDwellSeconds(Number(e.target.value))}
                style={{ ...inputStyle, width: 60, display: "inline-block", margin: "0 4px" }}
              />
              秒経過
            </label>
            <label style={checkboxLabel}>
              <input
                type="radio"
                checked={triggerMode === "any"}
                onChange={() => setTriggerMode("any")}
              />
              いずれか満たす
            </label>
            <label style={checkboxLabel}>
              <input
                type="radio"
                checked={triggerMode === "all"}
                onChange={() => setTriggerMode("all")}
              />
              すべて満たす
            </label>
          </Field>
          <Field label="デバイス">
            {(["pc", "sp", "tablet"] as const).map((d) => (
              <label key={d} style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={devices.includes(d)}
                  onChange={(e) =>
                    setDevices(e.target.checked ? [...devices, d] : devices.filter((x) => x !== d))
                  }
                />
                {d.toUpperCase()}
              </label>
            ))}
          </Field>
          <Field label="フリークエンシー">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <NumberField
                label="セッション内"
                value={frequency.perSession}
                onChange={(v) => setFrequency({ ...frequency, perSession: v })}
                suffix="回まで"
              />
              <NumberField
                label="1日"
                value={frequency.perDay}
                onChange={(v) => setFrequency({ ...frequency, perDay: v })}
                suffix="回まで"
              />
              <NumberField
                label="閉じたら"
                value={frequency.suppressDaysAfterClose}
                onChange={(v) => setFrequency({ ...frequency, suppressDaysAfterClose: v })}
                suffix="日間非表示"
              />
              <NumberField
                label="最短表示間隔"
                value={frequency.minIntervalSeconds}
                onChange={(v) => setFrequency({ ...frequency, minIntervalSeconds: v })}
                suffix="秒"
              />
            </div>
            <label style={checkboxLabel}>
              <input
                type="checkbox"
                checked={frequency.suppressAfterClick}
                onChange={(e) => setFrequency({ ...frequency, suppressAfterClick: e.target.checked })}
              />
              クリック後は非表示
            </label>
          </Field>
        </Section>

        <Section title="④ 表示位置">
          <Field label="PC">
            {POSITION_PC_OPTIONS.map((opt) => (
              <label key={opt.value} style={checkboxLabel}>
                <input
                  type="radio"
                  checked={positionPc === opt.value}
                  onChange={() => setPositionPc(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </Field>
          <Field label="SP">画面中央（固定）</Field>
          <label style={checkboxLabel}>
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            背景を暗くする
          </label>
          <label style={checkboxLabel}>
            <input type="checkbox" checked={closeButton} onChange={(e) => setCloseButton(e.target.checked)} />
            ×ボタンを表示
          </label>
        </Section>

        <Section title="⑤ クリエイティブ">
          {creatives.map((c, i) => (
            <div key={c.id ?? `new-${i}`} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  value={c.name}
                  onChange={(e) => updateCreative(i, { name: e.target.value })}
                  placeholder="クリエイティブ名"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select
                  value={c.status}
                  onChange={(e) => updateCreative(i, { status: e.target.value })}
                  style={{ ...inputStyle, width: 100 }}
                >
                  <option value="active">配信中</option>
                  <option value="paused">停止</option>
                </select>
                <button onClick={() => setCreatives(creatives.filter((_, idx) => idx !== i))}>削除</button>
              </div>
              <div style={{ display: "flex", gap: 16, marginBottom: 8 }}>
                <label style={{ ...checkboxLabel, marginBottom: 0 }}>
                  <input
                    type="radio"
                    checked={(c.linkAction ?? "url") === "url"}
                    onChange={() => updateCreative(i, { linkAction: "url" })}
                  />
                  リンク先URLへ遷移
                </label>
                <label style={{ ...checkboxLabel, marginBottom: 0 }}>
                  <input
                    type="radio"
                    checked={c.linkAction === "close"}
                    onChange={() => updateCreative(i, { linkAction: "close" })}
                  />
                  元のページに戻る（閉じる）
                </label>
              </div>
              {(c.linkAction ?? "url") === "url" && (
                <input
                  value={c.linkUrl}
                  onChange={(e) => updateCreative(i, { linkUrl: e.target.value })}
                  placeholder="https://..."
                  style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
                />
              )}
              <input
                value={c.altText}
                onChange={(e) => updateCreative(i, { altText: e.target.value })}
                placeholder="代替テキスト"
                style={{ ...inputStyle, width: "100%", marginBottom: 8 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {c.imagePc && (
                  <img
                    src={c.imagePc.fallback}
                    alt=""
                    style={{ width: 64, height: 64, objectFit: "contain", border: "1px solid #eee", borderRadius: 4 }}
                  />
                )}
                <label style={{ fontSize: 13 }}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "block" }}
                    disabled={uploadingIndex === i}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImageUpload(i, file);
                      e.target.value = "";
                    }}
                  />
                  {uploadingIndex === i && <span>アップロード中...</span>}
                </label>
              </div>
            </div>
          ))}
          {uploadError && <p style={{ color: "crimson", fontSize: 13 }}>{uploadError}</p>}
          <button
            onClick={() =>
              setCreatives([
                ...creatives,
                {
                  id: 0,
                  name: "新規クリエイティブ",
                  status: "active",
                  linkUrl: "",
                  linkTarget: "_blank",
                  linkAction: "url",
                  altText: "",
                  weight: 1,
                  assetPcId: null,
                  assetSpId: null,
                  imagePc: null,
                  imageSp: null,
                },
              ])
            }
          >
            ＋ クリエイティブを追加
          </button>
          <p style={{ color: "#666", fontSize: 13 }}>
            配信比率は均等（有効 {creatives.filter((c) => c.status === "active").length} 件中 各{" "}
            {creatives.filter((c) => c.status === "active").length > 0
              ? (100 / creatives.filter((c) => c.status === "active").length).toFixed(1)
              : 0}
            %）。画像は自動でPC/SP用にリサイズ・WebP変換されます（推奨: 横760px以上）。
          </p>
      </Section>

      <Section title="プレビュー">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={() => setPreviewDevice("pc")} disabled={previewDevice === "pc"}>
            PC
          </button>
          <button onClick={() => setPreviewDevice("sp")} disabled={previewDevice === "sp"}>
            SP
          </button>
        </div>
        {creatives.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <button onClick={() => setPreviewIndex((i) => (i - 1 + creatives.length) % creatives.length)}>◀</button>
            <span>
              {previewIndex + 1} / {creatives.length}
            </span>
            <button onClick={() => setPreviewIndex((i) => (i + 1) % creatives.length)}>▶</button>
          </div>
        )}
        {previewCreative ? (
          <>
            <button
              onClick={() => setEnlarged(true)}
              style={{ display: "block", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}
              aria-label="プレビューを拡大表示"
            >
              <PreviewPanel
                creative={previewCreative}
                device={previewDevice}
                positionPc={positionPc}
                positionSp="center"
                overlay={overlay}
                closeButton={closeButton}
              />
            </button>
            <p style={{ color: "#888", fontSize: 12, marginTop: 4 }}>クリックで拡大表示</p>
            {enlarged && (
              <div
                onClick={() => setEnlarged(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.6)",
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                }}
              >
                <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 8, padding: 16, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong>プレビュー拡大表示</strong>
                    <button onClick={() => setEnlarged(false)}>閉じる</button>
                  </div>
                  <PreviewPanel
                    creative={previewCreative}
                    device={previewDevice}
                    positionPc={positionPc}
                    positionSp="center"
                    overlay={overlay}
                    closeButton={closeButton}
                    scale={ENLARGED_SCALE[previewDevice]}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <p style={{ color: "#888" }}>クリエイティブを追加するとプレビューできます。</p>
        )}
      </Section>

      <div style={{ marginTop: 16 }}>
        <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px" }}>
          {saving ? "保存中..." : "保存"}
        </button>
        {savedAt && <span style={{ marginLeft: 12, color: "green" }}>保存しました</span>}
        {error && <span style={{ marginLeft: 12, color: "crimson" }}>{error}</span>}
      </div>
    </div>
  );

  function updateTarget(i: number, patch: Partial<Target>) {
    setTargets(targets.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  // Only "含める" rows have a page-specific preview: an "除外" pattern is a
  // page the popup should *not* show on, and a regex pattern isn't
  // generally a real, openable path.
  function previewUrl(t: Target): string | null {
    if (!initial.siteHost || t.kind !== "include" || t.matchType === "regex" || !t.pattern.trim()) return null;
    try {
      const url = new URL(t.pattern, `https://${initial.siteHost}`);
      url.searchParams.set("pz_preview", String(initial.id));
      return url.toString();
    } catch {
      return null;
    }
  }

  function updateCreative(i: number, patch: Partial<Creative>) {
    setCreatives(creatives.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #eee" }}>
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label style={{ fontSize: 13 }}>
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...inputStyle, width: 60, display: "inline-block", margin: "0 4px" }}
      />
      {suffix}
    </label>
  );
}

const inputStyle: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 4 };
const checkboxLabel: React.CSSProperties = { display: "block", fontSize: 14, marginBottom: 4 };
