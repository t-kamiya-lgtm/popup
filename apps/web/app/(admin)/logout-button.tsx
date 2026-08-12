"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      ログアウト
    </button>
  );
}
