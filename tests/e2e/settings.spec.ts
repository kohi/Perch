import { test, expect } from "@playwright/test";
import { openApp } from "./appHelpers";

/**
 * S-07 設定モーダルの本実装（Wave 4）。TC-704 設定の永続化を実 DOM で検証する。
 *
 * confidence 閾値・使用モデル・API キー・フォントサイズ既定を編集 → ページ再読込
 * （IndexedDB は同一オリジンのまま永続）→ 再度開いて **入力値が維持** されていることを
 * 実 input の value で assert する（偽装なし：DB を経由した往復を実挙動で確認）。
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("TC-704: confidence/model/apiKey/フォント既定を編集 → リロード後も維持", async ({ page }) => {
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();

  // 既定値の確認（本実装：無効枠ではなく実入力）。
  await expect(page.getByTestId("settings-confidence")).toHaveValue("0.8");
  await expect(page.getByTestId("settings-model")).toHaveValue("claude-sonnet-5");
  await expect(page.getByTestId("settings-apikey")).toHaveValue("");

  // 4項目を編集。
  await page.getByTestId("settings-confidence").fill("0.5");
  await page.getByTestId("settings-model").fill("claude-test-model");
  await page.getByTestId("settings-apikey").fill("sk-e2e-persist-123");
  await page.getByTestId("settings-fontsize").fill("22");
  await page.getByTestId("settings-close").click();

  // 再読込（プロセスは同一だが React state は初期化 → IndexedDB から復元させる）。
  await page.reload();
  await page.getByTestId("app").waitFor({ state: "visible", timeout: 20_000 });

  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("settings-confidence")).toHaveValue("0.5");
  await expect(page.getByTestId("settings-model")).toHaveValue("claude-test-model");
  await expect(page.getByTestId("settings-apikey")).toHaveValue("sk-e2e-persist-123");
  await expect(page.getByTestId("settings-fontsize")).toHaveValue("22");
});

test("confidence 閾値は [0,1] に clamp して保存される", async ({ page }) => {
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-confidence").fill("5");
  await page.getByTestId("settings-close").click();
  await page.reload();
  await page.getByTestId("app").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("settings-confidence")).toHaveValue("1");
});
