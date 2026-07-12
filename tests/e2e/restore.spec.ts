import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChrome, sigkill, gracefulClose, type ChromeHandle } from "./harness";

const APP_URL = process.env.PERCH_E2E_URL ?? "http://localhost:1420";

interface StoredTab {
  id: string;
  body: string;
  pinned: boolean;
}

function firstPage(browser: Browser): Page {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("no browser context from CDP connection");
  const page = ctx.pages()[0];
  if (!page) throw new Error("no page in context");
  return page;
}

async function openApp(browser: Browser): Promise<Page> {
  const page = firstPage(browser);
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("app").waitFor({ state: "visible", timeout: 20_000 });
  return page;
}

/** 実 IndexedDB を直接読み、保存が確かにコミットされたことを確認する（precondition）。 */
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

/**
 * 新規タブを1つ作り、本文を入力する。作成完了（tabcount 反映）→ 空エディタ確認 → 入力。
 * 編集面は CodeMirror（contenteditable）。fill/toHaveValue は使えないため、
 * `.cm-content` を click → keyboard.type、確認は toHaveText/innerText を使う。
 */
async function addTab(page: Page, body: string, expectedCount: number): Promise<void> {
  await page.getByTestId("new-tab").click();
  await expect(page.getByTestId("app")).toHaveAttribute("data-tabcount", String(expectedCount));
  const content = page.locator(".cm-content");
  await content.waitFor({ state: "visible" });
  await content.click();
  await expect(content).toHaveText(""); // 新規タブは空
  await page.keyboard.type(body);
  // 1文字ごと保存の実挙動を尊重しつつ、入力が反映されたことを確認
  await expect(content).toHaveText(body);
}

test("TC-103: 強制kill→再起動で入力メモが失われない（揮発防止の核心）", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "perch-e2e-kill-"));
  const port = 9333;
  const contents = ["税金の話をどこかでした", "買い物リスト 牛乳 卵", "コード片 <div>hello</div>"];

  let handle: ChromeHandle | null = null;
  try {
    // --- 起動1: 3タブに入力 ---
    handle = await launchChrome(userDataDir, port);
    let page = await openApp(handle.browser);
    for (let i = 0; i < contents.length; i++) {
      await addTab(page, contents[i]!, i + 1);
    }

    // precondition: 3件が実 IndexedDB にコミット済みであることを確認してから kill する
    await expect
      .poll(async () => (await readTabsFromIDB(page)).length, { timeout: 10_000 })
      .toBe(3);
    const before = await readTabsFromIDB(page);
    expect(before.map((t) => t.body).sort()).toEqual([...contents].sort());

    // --- 強制 kill（保存猶予なし。graceful close は使わない） ---
    await sigkill(handle.proc);
    handle = null;

    // --- 起動2: 同じ user-data-dir で再起動 → 復元検証 ---
    handle = await launchChrome(userDataDir, port);
    page = await openApp(handle.browser);

    await expect(page.getByTestId("tab-item")).toHaveCount(3);
    for (const c of contents) {
      await page
        .getByTestId("tab-item")
        .filter({ hasText: c })
        .first()
        .click();
      // 復元検証: タブを開いたら CM エディタが該当本文を表示している
      await expect(page.locator(".cm-content")).toHaveText(c);
    }
  } finally {
    if (handle) await sigkill(handle.proc);
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("TC-102: 通常終了→再起動で全タブが内容・順序・ピン状態そのまま復元", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "perch-e2e-restart-"));
  const port = 9334;
  const N = 10;

  let handle: ChromeHandle | null = null;
  try {
    // --- 起動1: 10タブ入力、うち2つをピン留め ---
    handle = await launchChrome(userDataDir, port);
    let page = await openApp(handle.browser);
    for (let i = 0; i < N; i++) {
      await addTab(page, `メモ${i} 本文`, i + 1);
    }
    // 3番目と7番目をピン留め（ピン用ボタンは各 tab-item 内）
    const pinTargets = ["メモ3 本文", "メモ7 本文"];
    for (const label of pinTargets) {
      await page
        .getByTestId("tab-item")
        .filter({ hasText: label })
        .getByTitle("ピン留めトグル")
        .click();
    }
    await expect
      .poll(async () => (await readTabsFromIDB(page)).length, { timeout: 10_000 })
      .toBe(N);

    // --- 通常終了 → 再起動 ---
    await gracefulClose(handle);
    handle = null;

    handle = await launchChrome(userDataDir, port);
    page = await openApp(handle.browser);

    await expect(page.getByTestId("tab-item")).toHaveCount(N);
    // 先頭2件がピン留め（📌）であること = ピン優先ソートの復元
    const titles = page.getByTestId("tab-item");
    await expect(titles.nth(0)).toContainText("📌");
    await expect(titles.nth(1)).toContainText("📌");
    // ピン対象の本文が復元されている
    await expect(page.getByTestId("tab-item").filter({ hasText: "メモ7 本文" })).toHaveCount(1);
    // 内容の抜き取り確認
    await page.getByTestId("tab-item").filter({ hasText: "メモ5 本文" }).first().click();
    await expect(page.locator(".cm-content")).toHaveText("メモ5 本文");
  } finally {
    if (handle) await sigkill(handle.proc);
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
