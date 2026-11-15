import type { NextConfig } from "next";

// Where the NestJS API runs. The browser never calls it directly: /api/* is proxied
// through this Next.js server, so the session cookie stays first-party (same origin).
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Uploads pass through this server on the way to the API. Next.js keeps only the first 10 MB of
    // a request by default, which cut every larger video short ("socket hang up"). Allow the API's own
    // limit (500 MB videos, MEDIA_MAX_VIDEO_MB) plus room for the form wrapping.
    proxyClientMaxBodySize: "510mb",
    // A big video over a slow connection takes minutes; do not give up on it after the default.
    proxyTimeout: 15 * 60_000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
