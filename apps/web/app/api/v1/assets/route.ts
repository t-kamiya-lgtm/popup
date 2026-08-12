import { NextRequest, NextResponse } from "next/server";
import { withAccount } from "@/lib/db";
import { requireAccountId } from "@/lib/require-account";
import { getCurrentSite } from "@/lib/current-site";
import { AssetUploadError, processAndStoreUpload } from "@/lib/assets";

// sharp needs the Node.js runtime (native binary) — the default for route
// handlers, but explicit since it's load-bearing here (an edge runtime
// would fail to import sharp at all).
export const runtime = "nodejs";

/** POST /api/v1/assets — multipart upload, resized + reformatted synchronously (see lib/assets.ts). */
export async function POST(req: NextRequest) {
  const accountId = await requireAccountId();
  if (accountId instanceof NextResponse) return accountId;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  try {
    return await withAccount(accountId, async (client) => {
      const site = await getCurrentSite(client);
      if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });
      const uploaded = await processAndStoreUpload(client, site.id, file);
      return NextResponse.json(uploaded, { status: 201 });
    });
  } catch (err) {
    if (err instanceof AssetUploadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
