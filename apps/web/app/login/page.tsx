"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
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
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
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
    </main>
  );
}
