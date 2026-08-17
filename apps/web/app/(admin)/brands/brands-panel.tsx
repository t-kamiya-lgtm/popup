"use client";

import { useEffect, useState } from "react";

interface Brand {
  id: number;
  name: string;
}

export function BrandsPanel() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/v1/brands");
    if (res.ok) setBrands((await res.json()).brands);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "追加に失敗しました");
        return;
      }
      setName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(brand: Brand) {
    if (!window.confirm(`ブランド「${brand.name}」を削除します。よろしいですか？`)) return;

    setRemovingId(brand.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/brands/${brand.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "削除に失敗しました");
        return;
      }
      await load();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ブランド名"
          required
          style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
        />
        <button type="submit" disabled={creating}>
          {creating ? "追加中..." : "追加する"}
        </button>
      </form>
      {error && <p style={{ color: "crimson", fontSize: 13 }}>{error}</p>}

      {brands === null ? (
        <p>読み込み中...</p>
      ) : brands.length === 0 ? (
        <p style={{ color: "#888" }}>まだブランドがありません。</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "8px 4px" }}>ブランド名</th>
              <th style={{ padding: "8px 4px" }}></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => (
              <tr key={b.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "8px 4px" }}>{b.name}</td>
                <td style={{ padding: "8px 4px" }}>
                  <button
                    type="button"
                    onClick={() => handleDelete(b)}
                    disabled={removingId === b.id}
                    style={{ fontSize: 12, color: "crimson" }}
                  >
                    {removingId === b.id ? "削除中..." : "削除"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
