import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// Vite builds the client; the Cloudflare plugin builds worker/ beside it and runs both in workerd for `vite dev`
// and `vite preview`, so the app and /api/* share one origin locally too. Tests use vitest.config.ts instead.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
