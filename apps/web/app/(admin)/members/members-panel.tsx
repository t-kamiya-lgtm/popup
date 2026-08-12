"use client";

import { useEffect, useState } from "react";

interface Member {
  email: string;
  role: "owner" | "editor" | "viewer";
  status: "active" | "invited";
  invitedAt: string;
}

const ROLE_LABEL: Record<Member["role"], string> = { owner: "オーナー", editor: "編集者", viewer: "閲覧者" };
const STATUS_LABEL: Record<Member["status"], string> = { active: "有効", invited: "招待中（未ログイン）" };

export function MembersPanel({ accountId }: { accountId: number }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/accounts/${accountId}/members`);
    if (res.ok) setMembers((await res.json()).members);
  }

  useEffect(() => {
    void load();
  }, [accountId]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "招待に失敗しました");
        return;
      }
      setEmail("");
      await load();
    } finally {
      setInviting(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <form onSubmit={handleInvite} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          required
          style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Member["role"])}
          style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        >
          <option value="owner">オーナー</option>
          <option value="editor">編集者</option>
          <option value="viewer">閲覧者</option>
        </select>
        <button type="submit" disabled={inviting}>
          {inviting ? "招待中..." : "招待する"}
        </button>
      </form>
      {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}

      {members === null ? (
        <p>読み込み中...</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "8px 4px" }}>メールアドレス</th>
              <th style={{ padding: "8px 4px" }}>権限</th>
              <th style={{ padding: "8px 4px" }}>状態</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
