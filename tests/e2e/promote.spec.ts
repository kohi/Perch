import { test, expect, type Page } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

/**
 * api.anthropic.com をモックし、AIタグ提案（confidence 付き JSON 配列）を返す。
 * 実 API は叩かない。suggestTags → parseTagResponse → splitByConfidence → UI の
 * 実データフローを検証できるよう、Anthropic Messages 応答形に包んで返す。
 */
async function mockClaudeTags(
  page: Page,
  tags: Array<{ name: string; confidence: number }>,
): Promise<void> {
  await page.route("**/api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(tags) }] }),
    });
  });
}

/** api.anthropic.com へのリクエストを常に失敗させる（TC-511 用）。 */
async function failClaude(page: Page): Promise<void> {
  await page.route("**/api.anthropic.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    await route.abort("failed");
  });
}

/** 設定モーダル経由で API キーを設定する（AI 機能を有効化）。 */
async function setApiKey(page: Page, key: string): Promise<void> {
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-apikey").fill(key);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
}

const confirmedChip = (page: Page, tag: string) =>
  page.locator(`[data-testid="confirmed-tag"][data-tag="${tag}"]`);
const suggestedChip = (page: Page, tag: string) =>
  page.locator(`[data-testid="suggested-tag"][data-tag="${tag}"]`);

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

test("TC-501/504/505/506/507/508: S-05 mozu 方式タグ確定 UI（ルール＋AI＋承認/却下/手動）", async ({
  page,
}) => {
  // AIタグをモック: 0.9=自動確定 / 0.5・0.4=提案止まり。
  await mockClaudeTags(page, [
    { name: "税金", confidence: 0.9 },
    { name: "確定申告", confidence: 0.5 },
    { name: "経費", confidence: 0.4 },
  ]);

  // ```html を含むタブ → ルールタグ code/html が確定に入る（TC-501）。
  await addTab(page, "確定申告メモ\n```html\n<p>x</p>\n```", 1);
  await setApiKey(page, "sk-e2e-tags");

  await page.getByTestId("promote-btn").click();
  await expect(page.getByTestId("promote-modal")).toBeVisible();

  // 確定タグ欄: ルール code/html（TC-501）＋ AI 自動確定 税金（TC-504）。
  await expect(confirmedChip(page, "code/html")).toBeVisible();
  await expect(confirmedChip(page, "税金")).toBeVisible();

  // 提案タグ欄: 0.5/0.4 は提案止まり（TC-505）。確定欄には入らない。
  await expect(suggestedChip(page, "確定申告")).toBeVisible();
  await expect(suggestedChip(page, "経費")).toBeVisible();
  await expect(confirmedChip(page, "確定申告")).toHaveCount(0);

  // 承認 → 確定へ移動（TC-506）。
  await suggestedChip(page, "確定申告").getByTestId("suggested-approve").click();
  await expect(confirmedChip(page, "確定申告")).toBeVisible();
  await expect(suggestedChip(page, "確定申告")).toHaveCount(0);

  // 却下 → 消える（TC-507）。
  await suggestedChip(page, "経費").getByTestId("suggested-reject").click();
  await expect(suggestedChip(page, "経費")).toHaveCount(0);

  // 手動追加 → 確定へ（TC-508）。Enter で確定。
  await page.getByTestId("promote-tag-input").fill("手動タグ");
  await page.getByTestId("promote-tag-input").press("Enter");
  await expect(confirmedChip(page, "手動タグ")).toBeVisible();

  // 重複追加は増えない。
  await page.getByTestId("promote-tag-input").fill("手動タグ");
  await page.getByTestId("promote-tag-add").click();
  await expect(confirmedChip(page, "手動タグ")).toHaveCount(1);

  // × で確定タグを削除。
  await confirmedChip(page, "手動タグ").getByTestId("confirmed-tag-remove").click();
  await expect(confirmedChip(page, "手動タグ")).toHaveCount(0);
});

test("TC-511: AI 通信失敗時は失敗表示＋ルール/手動タグで昇格 UI が使える", async ({ page }) => {
  await failClaude(page);
  await addTab(page, "オフラインでも\n```css\n.a{}\n```", 1);
  await setApiKey(page, "sk-e2e-fail");

  await page.getByTestId("promote-btn").click();
  await expect(page.getByTestId("promote-modal")).toBeVisible();

  // AI は失敗表示（スキップ可）。だがルールタグは確定に出る。
  await expect(page.getByTestId("promote-ai-error")).toBeVisible();
  await expect(confirmedChip(page, "code/css")).toBeVisible();

  // 手動タグは失敗後も追加できる（昇格導線を止めない）。
  await page.getByTestId("promote-tag-input").fill("手動でも");
  await page.getByTestId("promote-tag-add").click();
  await expect(confirmedChip(page, "手動でも")).toBeVisible();
});

test("ショートカット: Cmd+N で新規タブ / Cmd+F で検索入力にフォーカス", async ({ page }) => {
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "0");

  // Cmd+N → 新規タブ。
  await page.keyboard.press("Meta+n");
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "1");
  await page.keyboard.press("Meta+n");
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "2");

  // Cmd+F → 検索入力にフォーカス。
  await page.keyboard.press("Meta+f");
  await expect(page.getByTestId("search-input")).toBeFocused();
});
