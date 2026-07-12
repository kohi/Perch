import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 単体・結合テスト用（Vitest）。E2E(Playwright)は playwright.config.ts 側。
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // Playwright の spec を Vitest が拾わないよう除外
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
