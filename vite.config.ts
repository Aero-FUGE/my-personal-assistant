import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base:
    (globalThis as unknown as { process: { env: Record<string, string> } })
      .process.env.VITE_BASE_PATH || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "我的特助",
        short_name: "我的特助",
        description: "总裁的私人生活与事业管理助手",
        lang: "zh-CN",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#24152f",
        theme_color: "#2d1b38",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        globIgnores: ["assets/fonts/serif-+([0-9a-f]).woff2"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/fonts\/.*\.woff2$/,
            handler: "CacheFirst",
            options: {
              cacheName: "assistant-serif-v1",
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 70, maxAgeSeconds: 31536000 },
            },
          },
        ],
      },
    }),
  ],
});
