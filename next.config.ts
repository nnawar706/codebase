import type { NextConfig } from "next";
import { assertEnv } from "./lib/env";

assertEnv();

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Runs before the proxy, so a signed-out visit to / is remembered as
  // /dashboard in the sign-in redirect_url instead of bouncing back to /.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
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
