/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep server-only deps (pg) out of client bundles.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },
};

export default nextConfig;
