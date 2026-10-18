import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and handles its own terminal output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/spike/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // macOS 12+ (WKWebView ≈ Safari 15) and Windows WebView2 (evergreen Chromium).
    target: ["es2021", "safari15", "chrome105"],
    sourcemap: false,
  },
});
