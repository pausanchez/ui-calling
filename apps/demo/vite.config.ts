import { defaultClientConditions, defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // PUBLIC_URL lives in the repo's .env, like the API's settings. When it points at a tunnel,
  // Vite has to accept that host, or it blocks the screen and the webhook.
  const { PUBLIC_URL } = loadEnv(mode, "../..", "");
  const publicHost = PUBLIC_URL ? new URL(PUBLIC_URL).hostname : undefined;
  return {
    plugins: [react(), tailwindcss()],
    // Use the workspace packages' source, not their build (see "ui-calling-source" in their exports).
    resolve: { conditions: ["ui-calling-source", ...defaultClientConditions] },
    server: {
      port: 5173,
      allowedHosts: publicHost && publicHost !== "localhost" ? [publicHost] : [],
      // Keep the browser's Host: the API tells the local console apart from a tunnel by it (see app.ts).
      proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
    },
  };
});
