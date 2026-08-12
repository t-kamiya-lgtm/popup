import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/t.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2018",
  outfile: "dist/t.js",
  metafile: true,
});

const bytes = result.metafile.outputs["dist/t.js"].bytes;
console.log(`t.js: ${bytes} bytes (budget: 4096 gzip, this is raw — see docs/05-tag-sdk.md 8)`);
