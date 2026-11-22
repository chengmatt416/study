import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

const require = createRequire(import.meta.url);

export default defineConfig({
  server: { watch: { ignored: ["**/.openmaic/**"] } },
  worker: {
    plugins: () => [{
      name: "practice-markdown-worker",
      enforce: "pre",
      resolveId(id) {
        // Both packages offer DOM-free default exports for workers.
        if (id === "decode-named-character-reference" || id === "hast-util-from-html-isomorphic") return require.resolve(id);
      },
    }],
  },
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "STUDY",
        short_name: "STUDY",
        description: "電子書、重點整理、模擬試題、字卡複習",
        lang: "zh-TW",
        theme_color: "#0a0a0a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "今日複習", url: "/decks?due=1" },
          { name: "繼續閱讀", url: "/books?resume=1" },
        ],
      },
      workbox: {
        // GeoGebra / Qalculate / pdf.js 大檔不預先快取，改為使用時快取（見 runtimeCaching）
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["vendor/**", "**/pdf.worker*", "**/render.worker-*.js"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/(?:classroom|workspace|workbench|generation-preview)(?:\/|$)/, /^\/_next\//, /^\/vendor\//, /^\/authorize/, /^\/oauth\//, /^\/mcp/, /^\/\.well-known\//],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
            handler: 'CacheFirst',
            options: { cacheName: 'openmaic-static', expiration: { maxEntries: 400, maxAgeSeconds: 2592000 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/(?:classroom|workspace|workbench|generation-preview)(?:\/|$)/.test(url.pathname),
            handler: 'NetworkOnly',
            options: { fetchOptions: { cache: 'no-store' } },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 120, maxAgeSeconds: 31536000 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/vendor/"),
            handler: "CacheFirst",
            options: { cacheName: "vendor", expiration: { maxEntries: 600 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/") && /pdf\.worker/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "pdfjs" },
          },
          {
            // Lesson and quiz images never change once generated: show the saved copy at once and refresh it in the background.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/classroom-media/") && /\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "classroom-media", expiration: { maxEntries: 300, maxAgeSeconds: 604800 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
            options: { fetchOptions: { cache: "no-store" } },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
});
