import sharp from "sharp";
import type { PoolClient } from "pg";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 4000;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const BUCKET = "lp-ab-test-assets";

// Aspect-ratio drift beyond this, relative to the slot's reference image,
// triggers a validation warning (docs/lp-ab-test/00-requirements.md
// "画像バリデーション要") rather than a hard rejection — a deliberately
// different-shaped creative is a legitimate use case, just one worth
// flagging before it goes live.
const ASPECT_RATIO_WARN_THRESHOLD = 0.1;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function uploadToStorage(objectPath: string, buffer: Buffer, contentType: string): Promise<string> {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase Storage upload failed: ${res.status} ${text}`.slice(0, 500));
  }
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

export interface UploadedAsset {
  assetId: number;
  url: string;
  width: number;
  height: number;
}

export interface SizeWarning {
  message: string;
}

export function checkAspectRatio(
  candidate: { width: number; height: number },
  reference: { width: number; height: number } | null
): SizeWarning | null {
  if (!reference) return null;
  const candidateRatio = candidate.width / candidate.height;
  const referenceRatio = reference.width / reference.height;
  const drift = Math.abs(candidateRatio - referenceRatio) / referenceRatio;
  if (drift <= ASPECT_RATIO_WARN_THRESHOLD) return null;
  return {
    message: `既存の画像（${reference.width}×${reference.height}）とアスペクト比が大きく異なります（アップロードした画像: ${candidate.width}×${candidate.height}）。レイアウト崩れがないかご確認ください。`,
  };
}

export async function uploadCreativeAsset(
  client: PoolClient,
  buffer: Buffer,
  mime: string
): Promise<UploadedAsset> {
  if (buffer.byteLength > MAX_BYTES) throw new Error(`画像サイズが大きすぎます（上限 ${MAX_BYTES / 1024 / 1024}MB）`);
  if (!ALLOWED_MIME.has(mime)) throw new Error("対応していない画像形式です（jpeg/png/webpのみ）");

  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) throw new Error("画像を読み込めませんでした");
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new Error(`画像の縦横サイズが大きすぎます（上限 ${MAX_DIMENSION}px）`);
  }

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const objectPath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const url = await uploadToStorage(objectPath, buffer, mime);

  const { rows } = await client.query(
    `INSERT INTO assets (original_key, url, width, height, bytes, mime) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [objectPath, url, meta.width, meta.height, buffer.byteLength, mime]
  );
  return { assetId: Number(rows[0].id), url, width: meta.width, height: meta.height };
}
