import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Multipart framing sits on top of the 10 MB PDF limit. The route still
    // rejects a file larger than 10 MB; this only lets that check see the body.
    proxyClientMaxBodySize: "11mb",
  },
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    '127.0.0.1:3000',
    'localhost:3000',
    '127.0.0.1:8080',
    'localhost:8080',
    '10.101.3.132',
  ],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
