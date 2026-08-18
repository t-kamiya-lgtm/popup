/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep server-only deps out of client bundles.
  experimental: {
    serverComponentsExternalPackages: ["pg", "sharp"],
  },
  // @popup/shared ships TS source (workspace:*), not a compiled dist —
  // Next needs to transpile it like first-party code.
  transpilePackages: ["@popup/shared"],
};

export default nextConfig;
