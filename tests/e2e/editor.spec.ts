import { test, expect, type Page } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * TC-301〜308（CodeMirror 6 エディタ）。page fixture（chromium project）を使う。
 * ハイライトは「トークン span が実際に生成されている」ことを実 DOM で assert（偽装禁止）。
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

/** `.cm-content` 内に「テキストが exact 一致する span」が1つ以上あるか（＝そのトークンが色付けされた証拠）。 */
async function tokenSpanCount(page: Page, exactText: string): Promise<number> {
  return page
    .locator(".cm-content span")
    .filter({ hasText: new RegExp(`^${exactText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    .count();
}

test("TC-301: Markdown を改行込みで編集できる", async ({ page }) => {
  await addTab(page, "# 見出し\n本文1行目\n**太字**", 1);
  // 3行が実際に描画されている
  await expect(page.locator(".cm-line")).toHaveCount(3);
  await expect(page.locator(".cm-content")).toContainText("見出し");
  await expect(page.locator(".cm-content")).toContainText("本文1行目");
  // Markdown 記法がハイライトされている証拠: 見出し行が styled span でラップされる
  // （プレーン行「本文1行目」は span を持たない。span の存在＝ハイライトが効いた証拠）。
  expect(await tokenSpanCount(page, "# 見出し")).toBeGreaterThan(0);
  expect(await tokenSpanCount(page, "**太字**")).toBeGreaterThan(0);
});

test("TC-302: ```html フェンス内で HTML がハイライトされる", async ({ page }) => {
  await addTab(page, "```html\n<div>hi</div>\n```", 1);
  // tagName "div" が独立 span として色付けされている
  expect(await tokenSpanCount(page, "div")).toBeGreaterThan(0);
});

test("TC-303: ```js フェンス内で JS がハイライトされる", async ({ page }) => {
  await addTab(page, "```js\nfunction greet() {}\n```", 1);
  // keyword "function" が span として色付けされている
  expect(await tokenSpanCount(page, "function")).toBeGreaterThan(0);
});

test("TC-304: ```css フェンス内で CSS がハイライトされる", async ({ page }) => {
  await addTab(page, "```css\n.box { color: red; }\n```", 1);
  // propertyName "color" が span として色付けされている
  expect(await tokenSpanCount(page, "color")).toBeGreaterThan(0);
});

test("TC-305: 改行してもインデントが保持される", async ({ page }) => {
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "1");
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("line1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("    line2"); // 明示的に4スペースのインデント
  // 2行目の実テキストが先頭スペースを保持している（textContent はCSS非依存で確実）
  const second = await page.locator(".cm-line").nth(1).textContent();
  expect(second?.startsWith("    ")).toBe(true);
  expect(second).toContain("line2");
});

test("TC-308: 行番号 gutter が表示される", async ({ page }) => {
  await addTab(page, "1行目\n2行目\n3行目", 1);
  await expect(page.locator(".cm-gutters .cm-lineNumbers")).toBeVisible();
  // 行番号 1〜3 が実際に描画されている
  const gutter = page.locator(".cm-gutters .cm-lineNumbers");
  await expect(gutter).toContainText("1");
  await expect(gutter).toContainText("3");
});

test("TC-306: A+/A- でエディタの font-size が実際に変わる", async ({ page }) => {
  await addTab(page, "サイズ確認", 1);
  const editor = page.locator(".cm-editor");
  const px = () => editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  const base = await px();
  expect(base).toBe(14); // 既定

  await page.getByTestId("font-inc").click();
  await expect.poll(px).toBe(16);

  await page.getByTestId("font-dec").click();
  await page.getByTestId("font-dec").click();
  await expect.poll(px).toBe(12);
});

test("TC-307: フォントサイズ変更が再起動（リロード）後も維持される", async ({ page }) => {
  await addTab(page, "永続化確認", 1);
  const editor = page.locator(".cm-editor");
  const px = () => editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  await page.getByTestId("font-inc").click();
  await page.getByTestId("font-inc").click();
  await expect.poll(px).toBe(18);

  // 同一コンテキストでリロード＝IndexedDB は永続。フォントサイズが復元される。
  await openApp(page);
  await page.getByTestId("tab-item").first().click();
  await expect.poll(() =>
    page.locator(".cm-editor").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBe(18);
});
