"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewCampaignButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <button
      disabled={creating}
      onClick={async () => {
        setCreating(true);
        try {
          const res = await fetch("/api/v1/campaigns", { method: "POST" });
          const body = await res.json();
          if (res.ok) router.push(`/campaigns/${body.id}`);
        } finally {
          setCreating(false);
        }
      }}
    >
      + 新規作成
    </button>
  );
}
