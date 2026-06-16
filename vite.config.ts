import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5174,
    strictPort: false,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
