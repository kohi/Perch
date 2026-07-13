import { test, expect } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * タブ絞込フィルタ（S-02・拡張スロット本実装・requirements §3.2）。
 * 非 AI・オフラインで動く（キー不要）。表示のみで active/選択/DB に影響しないことを確認。
 */

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("タブ絞込: 部分一致で一致タブのみ表示、クリアで全件復帰（キー不要）", async ({ page }) => {
  await addTab(page, "税金の話\n本文1", 1);
  await addTab(page, "買い物リスト\n本文2", 2);
  await addTab(page, "TypeScript メモ\n本文3", 3);

  await expect(page.getByTestId("tab-item")).toHaveCount(3);

  const filter = page.getByTestId("tab-filter");

  // 「税金」で1件に絞られる。
  await filter.fill("税金");
  await expect(page.getByTestId("tab-item")).toHaveCount(1);
  await expect(page.getByTestId("tab-item").first()).toContainText("税金の話");

  // 大文字小文字無視。
  await filter.fill("typescript");
  await expect(page.getByTestId("tab-item")).toHaveCount(1);
  await expect(page.getByTestId("tab-item").first()).toContainText("TypeScript メモ");

  // 一致なしは控えめ表示、tab-item は0件。
  await filter.fill("存在しない語");
  await expect(page.getByTestId("tab-item")).toHaveCount(0);
  await expect(page.getByTestId("tab-filter-empty")).toBeVisible();

  // クリアで全件復帰（DB は不変＝絞込は表示のみ）。
  await filter.fill("");
  await expect(page.getByTestId("tab-item")).toHaveCount(3);
  await expect(page.getByTestId("tab-filter-empty")).toHaveCount(0);
});

test("タブ絞込: フィルタで隠れてもアクティブ本文はエディタに残る（表示のみ）", async ({ page }) => {
  await addTab(page, "残すメモ\n本文A", 1);
  await addTab(page, "別のメモ\n本文B", 2);

  // アクティブは直近作成の「別のメモ」。フィルタで一覧から隠す。
  await page.getByTestId("tab-filter").fill("残す");
  await expect(page.getByTestId("tab-item")).toHaveCount(1);
  // エディタのアクティブ本文（別のメモ）は絞込に影響されず保持される。
  await expect(page.locator(".cm-content")).toContainText("別のメモ");
});
