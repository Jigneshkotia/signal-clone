import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * `cacheComponents` and `partialPrefetching` are create-next-app defaults and
   * are deliberately off here.
   *
   * Every route in this app is a client component behind an auth guard: the
   * data all arrives over REST and a WebSocket after mount, and nothing is
   * fetched on the server. Partial prerendering therefore has nothing to
   * prerender, while its constraints (no reading the clock or route segments
   * during render) apply anyway. Turning them off keeps the build honest about
   * what this app actually is.
   */
  cacheComponents: false,
  partialPrefetching: false,

  // Dev assets are same-origin-checked; without this, loading the dev server
  // over 127.0.0.1 instead of localhost silently blocks the client chunks.
  allowedDevOrigins: ["127.0.0.1"],

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
