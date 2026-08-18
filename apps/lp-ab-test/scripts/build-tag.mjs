#!/usr/bin/env node
// Bundles apps/lp-ab-test/tag-src/{tag,cv-tag}.ts (which import
// @popup/shared's pickCreative for hash-based rotation) into standalone
// IIFEs under apps/lp-ab-test/public/, the same way packages/loader/build.mjs
// does for the popup tool's tag. Run before `next build` (see
// apps/lp-ab-test/package.json's build script) so the files exist for
// `next dev`/`next start` to serve as static assets.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(appRoot, "tag-src");
const outDir = join(appRoot, "public");

for (const name of ["tag", "cv-tag"]) {
  const result = await build({
    entryPoints: [join(srcDir, `${name}.ts`)],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2018",
    outfile: join(outDir, `${name}.js`),
    metafile: true,
  });
  const bytes = Object.values(result.metafile.outputs)[0].bytes;
  console.log(`${name}.js: ${bytes} bytes`);
}
