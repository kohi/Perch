import { test, expect } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * TC-201〜207（タブ操作・一覧）＋ S-06 破棄確認モーダル ＋ 右クリックメニュー。
 * page fixture（chromium project）を使う。各テストは新規コンテキスト＝空 IndexedDB から始まる。
 * 実 DOM の事実を assert（偽装禁止）。
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("TC-201: ＋新規で空タブ作成＆エディタに自動フォーカス", async ({ page }) => {
  await expect(page.getByTestId("tab-item")).toHaveCount(0);
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "1");
  await expect(page.getByTestId("tab-item")).toHaveCount(1);
  // 新規作成時にエディタ面へ実際にフォーカスが移っていること（TC-201）
  await expect(page.locator(".cm-content")).toBeFocused();
});

test("TC-202: 30タブを実生成し全件表示＆スクロールで破綻しない", async ({ page }) => {
  for (let i = 0; i < 30; i++) {
    await addTab(page, `タブ${i}`, i + 1);
  }
  // 実数を厳密に assert（>0 のような甘い判定はしない）
  await expect(page.getByTestId("tab-item")).toHaveCount(30);
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "30");

  // 一覧がスクロール可能（実際に内容が高さを超えて溢れている）
  const scroll = page.getByTestId("tablist-scroll");
  await expect(scroll).toBeVisible();
  const overflow = await scroll.evaluate(
    (el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible",
  );
  expect(overflow).toBe(true);
});

test("TC-203: ピン留めトグルで📌が最上部へ移動", async ({ page }) => {
  await addTab(page, "アルファ", 1);
  await addTab(page, "ブラボー", 2);
  await addTab(page, "チャーリー", 3);

  // 直近作成の「チャーリー」が先頭（updatedAt 降順）。末尾の「アルファ」をピン留めする。
  await expect(page.getByTestId("tab-item").nth(0)).toContainText("チャーリー");
  await page
    .getByTestId("tab-item")
    .filter({ hasText: "アルファ" })
    .getByTitle("ピン留めトグル")
    .click();

  // ピン留めした「アルファ」が最上部へ、かつ📌表示
  const top = page.getByTestId("tab-item").nth(0);
  await expect(top).toContainText("アルファ");
  await expect(top).toContainText("📌");
  // 非ピンは📌を持たない
  await expect(page.getByTestId("tab-item").filter({ hasText: "チャーリー" })).not.toContainText(
    "📌",
  );
});

test("TC-204/205: タイトル=本文1行目、空タブは『無題』", async ({ page }) => {
  await addTab(page, "確定申告のメモ\n2行目本文", 1);
  await expect(page.getByTestId("tab-item").filter({ hasText: "確定申告のメモ" })).toHaveCount(1);

  // 空タブ（本文未入力）は「無題」表示
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "2");
  await expect(page.getByTestId("tab-item").filter({ hasText: "無題" })).toHaveCount(1);
});

test("TC-206: 通常タブは updatedAt 降順", async ({ page }) => {
  await addTab(page, "ワン", 1);
  await addTab(page, "ツー", 2);
  await addTab(page, "スリー", 3);
  // 直近作成のスリーが先頭
  await expect(page.getByTestId("tab-item").nth(0)).toContainText("スリー");

  // ワンを編集（追記）すると最も新しくなり先頭へ移動
  await page.getByTestId("tab-item").filter({ hasText: "ワン" }).first().click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.type("追記");
  await expect(page.getByTestId("tab-item").nth(0)).toContainText("ワン追記");
});

test("TC-207: アクティブタブが視覚的に明示される", async ({ page }) => {
  await addTab(page, "最初のタブ", 1);
  await addTab(page, "次のタブ", 2);
  // 直近作成タブがアクティブ
  await expect(page.getByTestId("tab-item").filter({ hasText: "次のタブ" })).toHaveAttribute(
    "data-active",
    "true",
  );
  // 別タブへ切替 → アクティブが移る
  await page.getByTestId("tab-item").filter({ hasText: "最初のタブ" }).click();
  await expect(page.getByTestId("tab-item").filter({ hasText: "最初のタブ" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("tab-item").filter({ hasText: "次のタブ" })).toHaveAttribute(
    "data-active",
    "false",
  );
});

test("S-06: 破棄はモーダル確認。キャンセルで残存、破棄でDOMから消滅", async ({ page }) => {
  await addTab(page, "残すかもしれないメモ", 1);
  await expect(page.getByTestId("tab-item")).toHaveCount(1);

  // × → モーダル表示
  await page.getByTestId("tab-delete").click();
  await expect(page.getByTestId("discard-modal")).toBeVisible();
  // キャンセル → タブは残る
  await page.getByTestId("discard-cancel").click();
  await expect(page.getByTestId("discard-modal")).toHaveCount(0);
  await expect(page.getByTestId("tab-item")).toHaveCount(1);

  // 再度 × → 破棄 → DOM からタブ消滅（実 assert）
  await page.getByTestId("tab-delete").click();
  await expect(page.getByTestId("discard-modal")).toBeVisible();
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("discard-modal")).toHaveCount(0);
  await expect(page.getByTestId("tab-item")).toHaveCount(0);
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "0");
});

test("S-02: 右クリックメニューでピン留め／破棄", async ({ page }) => {
  await addTab(page, "右クリック対象", 1);
  await page.getByTestId("tab-item").first().click({ button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();

  // メニューからピン留め
  await page.getByTestId("ctx-pin").click();
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  await expect(page.getByTestId("tab-item").first()).toContainText("📌");

  // メニューから破棄 → モーダル → 破棄で消滅
  await page.getByTestId("tab-item").first().click({ button: "right" });
  await page.getByTestId("ctx-delete").click();
  await expect(page.getByTestId("discard-modal")).toBeVisible();
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("tab-item")).toHaveCount(0);
});
