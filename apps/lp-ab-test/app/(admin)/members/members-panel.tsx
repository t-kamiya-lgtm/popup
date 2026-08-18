"use client";

import { useEffect, useState } from "react";

interface Member {
  email: string;
  role: "admin" | "editor" | "viewer";
  status: "active" | "invited";
  invitedAt: string;
}

const ROLE_LABEL: Record<Member["role"], string> = { admin: "管理者", editor: "編集者", viewer: "閲覧者" };
const STATUS_LABEL: Record<Member["status"], string> = { active: "有効", invited: "招待中（未ログイン）" };

// No automatic invite email is sent — the inviter forwards this text
// themselves (Slack, etc.) so the invitee knows which Google account to use.
const LOGIN_URL = `${process.env.NEXT_PUBLIC_APP_BASE_URL ?? ""}/login`;

function inviteEmailText(email: string): string {
  return `件名: LPクリエイティブABテストツールへの招待

${email} 様

LPクリエイティブABテストツールの管理画面をご利用いただけるよう招待しました。
下記のURLから、このメールアドレスのGoogleアカウントでログインしてください。
ログインした時点でアカウントが有効になります。

ログインURL: ${LOGIN_URL}
`;
}

export function MembersPanel({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteTextFor, setInviteTextFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/members");
    if (res.ok) setMembers((await res.json()).members);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "招待に失敗しました");
        return;
      }
      setInviteTextFor(email);
      setCopied(false);
      setEmail("");
      await load();
    } finally {
      setInviting(false);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard API can be unavailable/blocked; the text is still visible
      // above for manual copy either way.
    }
  }

  async function handleRemove(m: Member) {
    const confirmMsg =
      m.status === "invited"
        ? `${m.email} への招待をキャンセルします。よろしいですか？`
        : `${m.email} をメンバーから削除します。よろしいですか？`;
    if (!window.confirm(confirmMsg)) return;

    setRemovingEmail(m.email);
    setError(null);
    try {
      const res = await fetch("/api/v1/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: m.email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "削除に失敗しました");
        return;
      }
      await load();
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      {isAdmin && (
        <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@primedirect.jp"
            required
            style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Member["role"])}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
          >
            <option value="admin">管理者</option>
            <option value="editor">編集者</option>
            <option value="viewer">閲覧者</option>
          </select>
          <button type="submit" disabled={inviting}>
            {inviting ? "招待中..." : "招待する"}
          </button>
        </form>
      )}
      {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}

      {inviteTextFor && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 16, background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>招待メール文面（自動送信はされません。コピーしてご自身で送ってください）</strong>
            <button type="button" onClick={() => setInviteTextFor(null)} style={{ fontSize: 12 }}>
              閉じる
            </button>
          </div>
          <textarea
            readOnly
            value={inviteEmailText(inviteTextFor)}
            style={{ width: "100%", height: 140, padding: 8, fontSize: 13, boxSizing: "border-box" }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={() => handleCopy(inviteEmailText(inviteTextFor))} style={{ marginTop: 8 }}>
            {copied ? "コピーしました" : "コピーする"}
          </button>
        </div>
      )}

      {members === null ? (
        <p>読み込み中...</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "8px 4px" }}>メールアドレス</th>
              <th style={{ padding: "8px 4px" }}>権限</th>
              <th style={{ padding: "8px 4px" }}>状態</th>
              <th style={{ padding: "8px 4px" }}></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.email} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 4px" }}>{m.email}</td>
                <td style={{ padding: "8px 4px" }}>{ROLE_LABEL[m.role]}</td>
                <td style={{ padding: "8px 4px", color: m.status === "invited" ? "#b8860b" : "#2a7" }}>
                  {STATUS_LABEL[m.status]}
                </td>
                <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                  {m.status === "invited" && (
                    <button
                      type="button"
                      onClick={() => {
                        setInviteTextFor(m.email);
                        setCopied(false);
                      }}
                      style={{ fontSize: 12, marginRight: 8 }}
                    >
                      招待文を表示
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleRemove(m)}
                      disabled={removingEmail === m.email}
                      style={{ fontSize: 12, color: "crimson" }}
                    >
                      {removingEmail === m.email ? "削除中..." : m.status === "invited" ? "招待をキャンセル" : "削除"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
