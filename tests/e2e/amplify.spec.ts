import { test, expect, type Page } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * 選択タブを増幅（S-04・拡張スロット本実装・requirements §6.7）。
 *
 * 実 API は叩かず route モックで下書きテキストを返す。増幅は「選択タブのみ」を送る
 * （TC-607 思想）。新規タブが実 IndexedDB に保存され、既存タブは不変であることを assert。
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

const DRAFT = "増幅された下書き本文";

/** 増幅応答（プレーンテキスト）を返し、送信 user メッセージを捕捉する。 */
async function mockAmplify(page: Page, captured: { userMsg: string }): Promise<void> {
  await page.route("**/api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const post = req.postDataJSON() as { messages?: Array<{ content?: string }> };
    captured.userMsg = post.messages?.[0]?.content ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ content: [{ type: "text", text: DRAFT }] }),
    });
  });
}

async function setApiKey(page: Page, key: string): Promise<void> {
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-apikey").fill(key);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
}

interface StoredTab {
  id: string;
  body: string;
}

/** 実 IndexedDB を直接読む（restore.spec と同方式）。生成タブの実保存を検証する。 */
async function readTabsFromIDB(page: Page): Promise<StoredTab[]> {
  return page.evaluate(async () => {
    const el = document.querySelector("[data-dbname]") as HTMLElement | null;
    const dbName = el?.dataset.dbname ?? "perch";
    return await new Promise<StoredTab[]>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("tabs", "readonly");
        const all = tx.objectStore("tabs").getAll();
        all.onsuccess = () => resolve(all.result as StoredTab[]);
        all.onerror = () => reject(all.error);
      };
    });
  });
}

/** タブ一覧で本文ラベルに一致する tab-item の選択チェックを入れる。 */
async function selectTab(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("tab-item")
    .filter({ hasText: label })
    .getByTestId("tab-select")
    .check();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("選択タブ増幅: 新規タブが増え本文=応答、既存タブ不変、IDB に実保存、選択タブのみ送信", async ({
  page,
}) => {
  const captured = { userMsg: "" };
  await mockAmplify(page, captured);

  // 3タブ作成。A/B を選択、C は非選択（送信されないことを検証）。
  await addTab(page, "選択A\nAAA本文", 1);
  await addTab(page, "選択B\nBBB本文", 2);
  await addTab(page, "非選択C\nUNSELECTED_MARK", 3);

  await setApiKey(page, "sk-e2e-amplify");

  // 未選択では増幅ボタンは無効（2タブ以上必要）。
  await expect(page.getByTestId("search-ext-amplify")).toBeDisabled();

  await selectTab(page, "選択A");
  await selectTab(page, "選択B");

  const amplify = page.getByTestId("search-ext-amplify");
  await expect(amplify).toBeEnabled();
  await amplify.click();

  // 完了メッセージ。
  await expect(page.getByTestId("search-amplify-done")).toBeVisible();

  // 新規タブが1つ増える（3 → 4）。
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", "4");

  // 生成タブがアクティブで、本文 = 応答テキスト。
  await expect(page.locator(".cm-content")).toHaveText(DRAFT);

  // 実 IndexedDB に生成タブが保存されている（偽装でなく実保存）。
  await expect
    .poll(async () => (await readTabsFromIDB(page)).length, { timeout: 10_000 })
    .toBe(4);
  const stored = await readTabsFromIDB(page);
  expect(stored.some((t) => t.body === DRAFT)).toBe(true);
  // 既存3タブの本文は不変。
  expect(stored.some((t) => t.body === "選択A\nAAA本文")).toBe(true);
  expect(stored.some((t) => t.body === "選択B\nBBB本文")).toBe(true);
  expect(stored.some((t) => t.body === "非選択C\nUNSELECTED_MARK")).toBe(true);

  // 送信 body: 選択タブの本文のみ。非選択タブの固有文字列は送らない。
  expect(captured.userMsg).toContain("AAA本文");
  expect(captured.userMsg).toContain("BBB本文");
  expect(captured.userMsg).not.toContain("UNSELECTED_MARK");
});
