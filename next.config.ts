import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / node-only packages stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp", "@react-pdf/renderer", "unpdf"],
  // Files read from disk at runtime (sample data, notice templates, migrations).
  outputFileTracingIncludes: {
    "/**": ["./sample-data/**/*", "./templates/**/*", "./drizzle/**/*", "./config/**/*"],
  },
  experimental: {
    // Uploads go through a server action. (Hosts such as Vercel cap request bodies lower than this.)
    serverActions: { bodySizeLimit: "26mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          // Rent rolls are private: keep every page out of search engines and shared caches.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
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
