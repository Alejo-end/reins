import { defineConfig } from "vite";

// BASE is the path the site is served from: "/" locally, "/reins/" on GitHub Pages.
export default defineConfig({
  base: process.env.BASE ?? "/",
  server: { port: 5210, strictPort: true },
  preview: { port: 5210, strictPort: true },
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 900 }, // three.js is most of it
});
