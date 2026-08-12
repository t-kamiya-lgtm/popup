import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the OAuth client_secret / access_token / refresh_token
// columns (docs/09-cart-integration.md 3.5 — "client_secret は機密情報。
// DB には暗号化して保存し、管理画面には再表示しない"). Output layout is
// iv(12) || authTag(16) || ciphertext, all in one Buffer, so a single BYTEA
// column holds everything needed to decrypt.
function key(): Buffer {
  const hex = requireEnv("ORDER_API_ENCRYPTION_KEY");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error("ORDER_API_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(stored: Buffer): string {
  const iv = stored.subarray(0, 12);
  const authTag = stored.subarray(12, 28);
  const ciphertext = stored.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
