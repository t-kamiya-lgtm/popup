"use client";

import { useEffect, useState } from "react";

interface Status {
  redirectUri: string;
  status: "not_connected" | "connected" | "expired" | "error";
  hasCredentials: boolean;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface SyncResult {
  succeeded: number;
  failed: number;
  unknown: number;
}

const STATUS_LABEL: Record<Status["status"], string> = {
  not_connected: "未連携",
  connected: "✓ 連携済み",
  expired: "有効期限切れ（再連携が必要）",
  error: "エラー",
};

export function OrderApiForm({ siteId }: { siteId: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState("https://www.primedirect.jp/api/oauth/authorize.php");
  const [tokenUrl, setTokenUrl] = useState("https://www.primedirect.jp/api/oauth/token.php");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [orderIdField, setOrderIdField] = useState<"order_id" | "ec_order_id">("order_id");

  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    const res = await fetch(`/api/v1/sites/${siteId}/order-api/status`);
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    void loadStatus();
    const params = new URLSearchParams(window.location.search);
    const result = params.get("result");
    if (result === "error") setError(params.get("message") ?? "連携に失敗しました");
    if (result) window.history.replaceState(null, "", window.location.pathname);
  }, [siteId]);

  async function handleSaveCredentials() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/order-api/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizeUrl, tokenUrl, apiBaseUrl, clientId, clientSecret, orderIdField }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "保存に失敗しました");
        return;
      }
      setClientSecret("");
      setShowCredentialForm(false);
      await loadStatus();
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/order-api/authorize-url`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "連携URLの生成に失敗しました");
        return;
      }
      window.location.href = body.url;
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("受注API連携を解除しますか？")) return;
    await fetch(`/api/v1/sites/${siteId}/order-api/disconnect`, { method: "POST" });
    await loadStatus();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/order-api/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "同期に失敗しました");
        return;
      }
      setSyncResult(body);
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }

  if (!status) return <p>読み込み中...</p>;

  const daysLeft = status.tokenExpiresAt
    ? Math.floor((new Date(status.tokenExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div style={{ marginBottom: 12 }}>
        状態: <strong>{STATUS_LABEL[status.status]}</strong>
        {status.status === "connected" && daysLeft !== null && (
          <span style={{ color: daysLeft <= 10 ? "crimson" : "#666" }}> （有効期限まで残り {daysLeft} 日）</span>
        )}
      </div>

      {status.status === "connected" ? (
        <div>
          <p style={{ fontSize: 13, color: "#666" }}>
            直近の同期: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("ja-JP") : "未実行"}
          </p>
          {status.lastError && <p style={{ color: "crimson", fontSize: 13 }}>{status.lastError}</p>}
          <button onClick={handleSync} disabled={syncing}>
            {syncing ? "同期中..." : "今すぐ同期"}
          </button>
          <button onClick={handleDisconnect} style={{ marginLeft: 8 }}>
            連携を解除
          </button>
          {syncResult && (
            <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
              成功 {syncResult.succeeded}件 / 不明 {syncResult.unknown}件 / 失敗 {syncResult.failed}件
            </p>
          )}
        </div>
      ) : (
        <div>
          <ol style={{ fontSize: 13, color: "#444", paddingLeft: 20 }}>
            <li>スマレジEC・リピート管理画面の「基本設定＞外部アプリ連携」でアプリを登録</li>
          </ol>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input readOnly value={status.redirectUri} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => navigator.clipboard.writeText(status.redirectUri)}>コピー</button>
          </div>

          {status.hasCredentials && !showCredentialForm ? (
            <div>
              <p style={{ fontSize: 13, color: "#666" }}>クライアントID・シークレットは登録済みです。</p>
              <button onClick={handleConnect} disabled={connecting}>
                {connecting ? "遷移中..." : "連携する"}
              </button>
              <button onClick={() => setShowCredentialForm(true)} style={{ marginLeft: 8 }}>
                資格情報を編集
              </button>
            </div>
          ) : (
            <div>
              <Field label="authorize_url">
                <input value={authorizeUrl} onChange={(e) => setAuthorizeUrl(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="token_url">
                <input value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="APIベースURL（受注検索エンドポイント用）">
                <input
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://www.primedirect.jp"
                  style={inputStyle}
                />
              </Field>
              <Field label="クライアントID">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="クライアントシークレット">
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="注文番号の突合キー">
                <select value={orderIdField} onChange={(e) => setOrderIdField(e.target.value as typeof orderIdField)} style={inputStyle}>
                  <option value="order_id">order_id</option>
                  <option value="ec_order_id">ec_order_id</option>
                </select>
              </Field>
              <button
                onClick={handleSaveCredentials}
                disabled={saving || !authorizeUrl || !tokenUrl || !apiBaseUrl || !clientId || !clientSecret}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: "#555", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: 6, border: "1px solid #ccc", borderRadius: 4, width: "100%" };
