import { test, expect } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * S-05 Vault 昇格ダイアログの UI（非 Tauri = ブラウザ経路）。
 *
 * 実ファイル書き込みは Tauri 必須のため E2E 対象外（人間ゲート）。ここでは
 * 「ダイアログが開く／タイトル編集可／キャンセルで閉じ、タブが残る（データ喪失なし）」
 * を実 DOM の事実で assert する。非 Tauri ではオンボーディングが出ないことも前提確認。
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("非 Tauri ではオンボーディング(S-08)が出ない", async ({ page }) => {
  await expect(page.getByTestId("onboarding-modal")).toHaveCount(0);
});

test("S-05: ［これ残す］でダイアログが開き、タイトル編集可、キャンセルでタブが残る", async ({
  page,
}) => {
  await addTab(page, "確定申告のメモ\n本文いろいろ", 1);
  await expect(page.getByTestId("tab-item")).toHaveCount(1);

  // 空タブでは昇格ボタンは無効 → 本文ありでは有効
  const promote = page.getByTestId("promote-btn");
  await expect(promote).toBeEnabled();
  await promote.click();

  // ダイアログ表示・保存先 inbox/ 固定表示
  await expect(page.getByTestId("promote-modal")).toBeVisible();
  await expect(page.getByTestId("promote-dest")).toHaveText("inbox/");

  // タイトル入力は本文1行目が初期値。編集できる。
  const titleInput = page.getByTestId("promote-title-input");
  await expect(titleInput).toHaveValue("確定申告のメモ");
  await titleInput.fill("編集後のタイトル");
  await expect(titleInput).toHaveValue("編集後のタイトル");

  // キャンセル → ダイアログが閉じ、タブは残る（データ喪失なし）
  await page.getByTestId("promote-cancel").click();
  await expect(page.getByTestId("promote-modal")).toHaveCount(0);
  await expect(page.getByTestId("tab-item")).toHaveCount(1);
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "1");

  // 本文もエディタに保持されている
  await expect(page.locator(".cm-content")).toContainText("確定申告のメモ");
});

test("空タブでは昇格ボタンが無効", async ({ page }) => {
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "1");
  await expect(page.getByTestId("promote-btn")).toBeDisabled();
});

test("S-07: ⚙で設定モーダルが開き、閉じられる（非 Tauri は Vault 未設定表示）", async ({
  page,
}) => {
  await page.getByTestId("settings-open").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("settings-vault-path")).toHaveText("未設定");
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
});
