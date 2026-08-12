#!/usr/bin/env node
// Copies the built loader/SDK bundles into apps/web/public for local
// `next dev`/`next start` convenience. Production serves these from a CDN
// (docs/02-architecture.md), not from this Next.js app — this script exists
// purely so `curl localhost:3000/t.js` works the same way locally.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)) + "/..";
const publicDir = join(root, "apps/web/public");
mkdirSync(publicDir, { recursive: true });

copyFileSync(join(root, "packages/loader/dist/t.js"), join(publicDir, "t.js"));
copyFileSync(join(root, "packages/sdk/dist/sdk.js"), join(publicDir, "sdk.js"));

console.log("Copied t.js and sdk.js into apps/web/public/");
