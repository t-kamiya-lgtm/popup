import { NextResponse, type NextRequest } from "next/server";
import { runDailyOptimization } from "@/lib/optimize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered by Vercel Cron (see vercel.json). Vercel signs its own cron
// requests with this header — see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
// Also callable manually (e.g. from a shell) with the same bearer token for
// on-demand re-runs.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDailyOptimization();
  return NextResponse.json({ ok: true, ...result });
}
