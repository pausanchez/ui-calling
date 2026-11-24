import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Use the workspace packages' source, not their build (see "ui-calling-source" in their exports).
  resolve: { conditions: ["ui-calling-source", ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
