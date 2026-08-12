import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PoolClient } from "pg";
import type { ImageVariant } from "@popup/shared";

/** Both `Pool` and `PoolClient` satisfy this — callers pass whichever they already have. */
type Queryable = Pick<PoolClient, "query">;

const MAX_BYTES = 10 * 1024 * 1024; // docs/06-admin.md 3.1: 原本は 10MB まで
const MAX_DIMENSION = 4000; // docs/06-admin.md 3.1: 原本は 4000px まで
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// docs/06-admin.md 3.1 specifies signed-URL-direct-to-storage + a separate
// optimization worker + CDN. Phase 1 has neither an object store nor a job
// queue, so this pipeline runs synchronously in the request and writes to
// apps/web/public/uploads/ instead — same assets/asset_variants schema and
// same output shape (resize, format fallback), so swapping in real storage
// later only touches this file, not the DB model or the admin UI.
const TARGET_WIDTH: Record<"pc" | "sp", number> = { pc: 380, sp: 320 };

export interface UploadedAsset {
  assetId: number;
  images: { pc: ImageVariant; sp: ImageVariant };
}

export class AssetUploadError extends Error {}

export async function processAndStoreUpload(
  client: PoolClient,
  siteId: number,
  file: File
): Promise<UploadedAsset> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new AssetUploadError("対応していない画像形式です（jpeg / png / webp のみ）");
  }
  if (file.size > MAX_BYTES) {
    throw new AssetUploadError("ファイルサイズは10MBまでです");
  }

  const original = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(original).metadata();
  if (!meta.width || !meta.height) {
    throw new AssetUploadError("画像を読み込めませんでした");
  }
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new AssetUploadError(`画像の長辺は${MAX_DIMENSION}pxまでです`);
  }

  const {
    rows: [asset],
  } = await client.query(
    `INSERT INTO assets (site_id, original_key, width, height, bytes, mime, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'processing') RETURNING id`,
    [siteId, file.name || "upload", meta.width, meta.height, file.size, file.type]
  );
  const assetId = Number(asset.id);

  const dir = path.join(process.cwd(), "public", "uploads", String(siteId), String(assetId));
  await mkdir(dir, { recursive: true });

  const images = {} as { pc: ImageVariant; sp: ImageVariant };
  for (const purpose of ["pc", "sp"] as const) {
    images[purpose] = await buildVariant(client, assetId, siteId, dir, purpose, original, meta.hasAlpha === true);
  }

  await client.query(`UPDATE assets SET status = 'ready' WHERE id = $1`, [assetId]);

  return { assetId, images };
}

async function buildVariant(
  client: PoolClient,
  assetId: number,
  siteId: number,
  dir: string,
  purpose: "pc" | "sp",
  original: Buffer,
  hasAlpha: boolean
): Promise<ImageVariant> {
  const resized = sharp(original).rotate().resize({ width: TARGET_WIDTH[purpose], withoutEnlargement: true });

  const webpBuffer = await resized.clone().webp({ quality: 80 }).toBuffer();
  const webpMeta = await sharp(webpBuffer).metadata();
  const webpPath = `${purpose}.webp`;
  await writeFile(path.join(dir, webpPath), webpBuffer);

  // Transparent originals fall back to PNG (flattening to JPEG would bake
  // in a solid background); opaque ones fall back to JPEG for the smaller
  // file size. See docs/06-admin.md 3.1.
  const fallbackFormat = hasAlpha ? "png" : "jpeg";
  const fallbackBuffer = hasAlpha
    ? await resized.clone().png({ compressionLevel: 8 }).toBuffer()
    : await resized.clone().flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  const fallbackExt = hasAlpha ? "png" : "jpg";
  const fallbackPath = `${purpose}.${fallbackExt}`;
  await writeFile(path.join(dir, fallbackPath), fallbackBuffer);

  const urlBase = `/uploads/${siteId}/${assetId}`;
  const webpUrl = `${urlBase}/${webpPath}`;
  const fallbackUrl = `${urlBase}/${fallbackPath}`;

  await client.query(
    `INSERT INTO asset_variants (asset_id, purpose, dpr, format, width, height, url, bytes)
     VALUES ($1, $2, 1, 'webp', $3, $4, $5, $6)`,
    [assetId, purpose, webpMeta.width, webpMeta.height, webpUrl, webpBuffer.length]
  );
  await client.query(
    `INSERT INTO asset_variants (asset_id, purpose, dpr, format, width, height, url, bytes)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7)`,
    [assetId, purpose, fallbackFormat, webpMeta.width, webpMeta.height, fallbackUrl, fallbackBuffer.length]
  );

  return {
    w: webpMeta.width ?? TARGET_WIDTH[purpose],
    h: webpMeta.height ?? TARGET_WIDTH[purpose],
    webp: webpUrl,
    fallback: fallbackUrl,
  };
}

/** Builds the {pc, sp} ImageVariant pair for a creative from its stored asset_pc_id/asset_sp_id. */
export async function loadCreativeImages(
  client: Queryable,
  assetPcId: number | null,
  assetSpId: number | null
): Promise<{ pc: ImageVariant | null; sp: ImageVariant | null }> {
  const [pc, sp] = await Promise.all([
    assetPcId ? loadVariant(client, assetPcId, "pc") : Promise.resolve(null),
    assetSpId ? loadVariant(client, assetSpId, "sp") : Promise.resolve(null),
  ]);
  return { pc, sp };
}

async function loadVariant(client: Queryable, assetId: number, purpose: "pc" | "sp"): Promise<ImageVariant | null> {
  const { rows } = await client.query(
    `SELECT format, url, width, height FROM asset_variants WHERE asset_id = $1 AND purpose = $2`,
    [assetId, purpose]
  );
  if (rows.length === 0) return null;
  const webp = rows.find((r) => r.format === "webp");
  const fallback = rows.find((r) => r.format !== "webp");
  if (!fallback) return null;
  return {
    w: fallback.width,
    h: fallback.height,
    webp: webp?.url,
    fallback: fallback.url,
  };
}
