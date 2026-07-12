import { expect, type Page } from "@playwright/test";

/**
 * page fixture（chromium project）を使う spec 用の共通ヘルパ。
 * CodeMirror の編集面 `.cm-content` は contenteditable のため、
 * Playwright の fill/toHaveValue は使えない → keyboard.type と innerText/toHaveText を使う。
 */

/** アプリを開き、復元完了（app 可視）まで待つ。 */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("app").waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * ＋新規でタブを作り、本文を入力する。
 * 作成完了（tabcount 反映）→ エディタ面 click → keyboard.type。
 */
export async function addTab(page: Page, body: string, expectedCount: number): Promise<void> {
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", String(expectedCount));
  const content = page.locator(".cm-content");
  await content.waitFor({ state: "visible" });
  await content.click();
  // 直前タブの内容が残っていないこと（新規タブは空）を確認してから入力
  await expect(content).toHaveText("");
  if (body.length > 0) await page.keyboard.type(body);
}

/** 現在エディタに表示されている本文テキスト（.cm-content の innerText）。 */
export async function editorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").innerText()).replace(/ /g, " ");
}

/** エディタ面へフォーカスして type する（既存タブへの追記等）。 */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type(text);
}
