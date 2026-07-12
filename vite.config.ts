import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri は固定ポートを期待する。dev/preview とも 1420 系で揃える。
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Tauri: エラーを隠さないよう clearScreen を無効化
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      // Rust 側の変更は tauri が監視するので vite からは除外
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 1420,
    strictPort: true,
  },
  // Tauri は現状 macOS で WKWebView(Safari 相当)。ビルドターゲットを合わせる
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
