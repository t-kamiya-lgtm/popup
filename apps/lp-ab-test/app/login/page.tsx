"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setClientError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Re-shows the account picker — this is a shared work admin tool,
          // not a personal app (same reasoning as the popup tool's login).
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      // On success the browser is already navigating away to Google —
      // intentionally leave `loading` true rather than resetting it.
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "ログインを開始できませんでした。");
      setLoading(false);
    }
  }

  const errorMessage: Record<string, string> = {
    not_invited: "このメールアドレスは招待されていません。管理者に招待を依頼してください。",
    wrong_domain: "社内のGoogleアカウント（@primedirect.jp）でログインしてください。",
  };

  return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 24 }}>LPクリエイティブABテストツール</h1>
        {searchParams.error && (
          <p style={{ color: "crimson", fontSize: 13, marginBottom: 16 }}>
            {errorMessage[searchParams.error] ?? "ログインに失敗しました。"}
          </p>
        )}
        {clientError && <p style={{ color: "crimson", fontSize: 13, marginBottom: 16 }}>{clientError}</p>}
        {/* TEMPORARY diagnostic — remove once the env var issue is confirmed fixed */}
        <p style={{ fontSize: 11, color: "#999", marginBottom: 16 }}>
          debug: URL=[{process.env.NEXT_PUBLIC_SUPABASE_URL ?? "MISSING"}] ANON=[
          {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 12) + "..." : "MISSING"}]
        </p>
        <button onClick={handleLogin} disabled={loading} style={{ padding: "10px 20px" }}>
          {loading ? "リダイレクト中..." : "Googleでログイン"}
        </button>
      </div>
    </div>
  );
}
