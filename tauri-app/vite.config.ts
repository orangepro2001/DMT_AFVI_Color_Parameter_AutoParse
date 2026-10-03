import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Port 1420 must stay in sync with tauri.conf.json devUrl.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
