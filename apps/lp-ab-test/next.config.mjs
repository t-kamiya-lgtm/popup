/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep server-only deps out of client bundles.
  experimental: {
    serverComponentsExternalPackages: ["pg", "sharp"],
  },
  // Note: @popup/shared (workspace:*) is only imported at runtime from
  // tag-src/*.ts, which scripts/build-tag.mjs bundles with esbuild directly
  // — never through this Next.js app's own webpack build. If a runtime
  // (non-type-only) import of @popup/shared is ever added inside app/ or
  // lib/, see apps/web/lib/lookup-url-match.ts's comment: transpilePackages
  // alone does not make webpack resolve that package's ESM ".js"-suffixed
  // relative imports, so such an import would need the same
  // duplicate-the-small-pure-function workaround instead.
};

export default nextConfig;
