import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, proxia /api al backend Hono (puerto 8000).
// En build, el output va a web/dist y lo sirve el backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
