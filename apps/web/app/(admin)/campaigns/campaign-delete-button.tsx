"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CampaignDeleteButton({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(`キャンペーン「${name}」を削除します。よろしいですか？`)) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/campaigns/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "削除に失敗しました");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleDelete} disabled={deleting} style={{ fontSize: 12, color: "crimson" }}>
        {deleting ? "削除中..." : "削除"}
      </button>
      {error && <p style={{ color: "crimson", fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
    </div>
  );
}
