import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2018",
  outfile: "dist/sdk.js",
  metafile: true,
});

const bytes = result.metafile.outputs["dist/sdk.js"].bytes;
console.log(`sdk.js: ${bytes} bytes (budget: 15KB gzip, this is raw — see docs/05-tag-sdk.md 8)`);
