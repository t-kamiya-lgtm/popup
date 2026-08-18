"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Re-shows the account picker — this is a shared work admin tool,
        // not a personal app (same reasoning as the popup tool's login).
        queryParams: { prompt: "select_account" },
      },
    });
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
        <button onClick={handleLogin} disabled={loading} style={{ padding: "10px 20px" }}>
          {loading ? "リダイレクト中..." : "Googleでログイン"}
        </button>
      </div>
    </div>
  );
}
