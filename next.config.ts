import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / node-only packages stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3", "sharp", "@react-pdf/renderer", "unpdf"],
  // Files read from disk at runtime (sample data, notice templates, migrations).
  outputFileTracingIncludes: {
    "/**": ["./sample-data/**/*", "./templates/**/*", "./drizzle/**/*", "./config/**/*"],
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
