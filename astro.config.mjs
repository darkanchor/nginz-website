import { defineConfig, passthroughImageService } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static-first: Astro builds HTML content pages.
// All dynamic API ownership lives in the separate Worker runtime at worker/.
// No Astro API routes — "/api/*" is exclusively the Worker's domain.
export default defineConfig({
  integrations: [sitemap()],
  devToolbar: { enabled: false },
  output: "static",
  site: "https://darkanchor.com",
  image: {
    service: passthroughImageService(),
  },
  markdown: {
    syntaxHighlight: false,
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
