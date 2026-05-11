import { defineConfig, passthroughImageService } from "astro/config";

// Static-first: Astro builds HTML content pages.
// All dynamic API ownership lives in the separate Worker runtime at worker/.
// No Astro API routes — "/api/*" is exclusively the Worker's domain.
export default defineConfig({
  output: "static",
  site: "https://nginz.dev",
  image: {
    service: passthroughImageService(),
  },
  build: {
    assets: "_assets",
  },
  server: {
    port: 4321,
  },
  vite: {
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8788",
        "/webhooks": "http://127.0.0.1:8788",
      },
    },
  },
});
