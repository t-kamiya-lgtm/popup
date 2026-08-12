"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const ERROR_LABEL: Record<string, string> = {
  invalid_state: "ログイン処理がタイムアウトしました。もう一度お試しください",
  google_exchange_failed: "Googleとの通信に失敗しました。もう一度お試しください",
  email_not_verified: "Googleアカウントのメールアドレスが未確認です",
  not_invited: "このメールアドレスは招待されていません。管理者に招待を依頼してください",
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const googleError = searchParams.get("error");

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "ログインに失敗しました");
        return;
      }
      router.push("/campaigns");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20 }}>ログイン</h1>
      <p style={{ color: "#666", fontSize: 13 }}>招待されたアカウントのみログインできます。</p>

      {googleError && (
        <p style={{ color: "crimson", fontSize: 13 }}>{ERROR_LABEL[googleError] ?? "ログインに失敗しました"}</p>
      )}

      <a
        href="/api/v1/auth/google/start"
        style={{
          display: "block",
          textAlign: "center",
          padding: 10,
          marginTop: 16,
          border: "1px solid #ccc",
          borderRadius: 4,
          textDecoration: "none",
          color: "#222",
        }}
      >
        Googleでログイン
      </a>

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={() => setShowPasswordForm((v) => !v)}
          style={{ fontSize: 12, color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {showPasswordForm ? "▲ パスワードでログイン（開発用）を閉じる" : "▼ パスワードでログイン（開発用）"}
        </button>
        {showPasswordForm && (
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label>
              メールアドレス
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              />
            </label>
            <label>
              パスワード
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              />
            </label>
            {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}
            <button type="submit" disabled={submitting} style={{ padding: 10 }}>
              {submitting ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
