import { defineConfig } from "@playwright/test";

/**
 * E2E: 揮発防止（強制kill→再起動の復元 = TC-103）の実プロセス検証。
 *
 * ブラウザは各 spec が自前で spawn する（固定 user-data-dir ＋ CDP）。
 * これにより実プロセスを SIGKILL でき、実ディスクの IndexedDB 永続を検証できる。
 * webServer はビルド済みフロントを配信するだけ（Tauri 非依存で動く Wave 1 構成）。
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
