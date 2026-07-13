import { test, expect, type Page } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * 関連メモをあぶり出す（S-04・拡張スロット本実装・requirements §6.7）。
 *
 * 実 API は叩かず api.anthropic.com を route モック。related のプロンプトは検索と同じ
 * 「候補一覧(JSON):」マーカーを使うので、候補 id を読んで score を付ける。
 * 送信 body の実体を捕捉し、related に全文本文/パスが混入しないこと（TC-607 同方式）も assert。
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

function candidatesFromPrompt(userMsg: string): Array<{ id: string; title: string }> {
  const marker = "候補一覧(JSON):";
  const idx = userMsg.lastIndexOf(marker);
  if (idx === -1) return [];
  try {
    return JSON.parse(userMsg.slice(idx + marker.length).trim()) as Array<{
      id: string;
      title: string;
    }>;
  } catch {
    return [];
  }
}

/** api.anthropic.com をモックし、送信された user メッセージを捕捉する。 */
async function mockClaude(
  page: Page,
  ranker: (cands: Array<{ id: string; title: string }>) => Array<{ id: string; score: number }>,
  captured: { userMsg: string },
): Promise<void> {
  await page.route("**/api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const post = req.postDataJSON() as { messages?: Array<{ content?: string }> };
    const userMsg = post.messages?.[0]?.content ?? "";
    captured.userMsg = userMsg;
    const ranking = ranker(candidatesFromPrompt(userMsg));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(ranking) }] }),
    });
  });
}

async function setApiKey(page: Page, key: string): Promise<void> {
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-apikey").fill(key);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("関連あぶり出し: 起点=アクティブタブで候補が結果に出て、クリックで開く / 全文は送らない", async ({
  page,
}) => {
  const captured = { userMsg: "" };
  // 候補 title に「アルファ」を含むものを最上位に。
  await mockClaude(
    page,
    (cands) => cands.map((c) => ({ id: c.id, score: c.title.includes("アルファ") ? 0.95 : 0.3 })),
    captured,
  );

  // 候補タブ2つ。tab1 は excerpt(120字)を超える末尾に秘密文字列を仕込む。
  const longTail = "あ".repeat(200) + "SECRET_TAIL";
  await addTab(page, "アルファのメモ\n" + longTail, 1);
  await addTab(page, "ベータのメモ\n買い物リスト", 2);
  // 起点（アクティブ）タブを最後に作る。
  await addTab(page, "起点のメモ\n関連を探したい", 3);

  await setApiKey(page, "sk-e2e-related");

  const surface = page.getByTestId("search-ext-surface");
  await expect(surface).toBeEnabled();
  await surface.click();

  // 起点以外の2候補が結果に出る（起点自身は候補にしない）。
  const results = page.getByTestId("search-result");
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText("アルファのメモ");

  // 結果クリック → そのタブがエディタで開く。
  await results.first().click();
  await expect(page.locator(".cm-content")).toContainText("アルファのメモ");

  // 送信 body の実体検査: 起点タイトルは送るが、候補の excerpt 超過分（全文）は送らない。
  expect(captured.userMsg).toContain("起点のメモ");
  expect(captured.userMsg).not.toContain("SECRET_TAIL");
});

test("関連あぶり出し: APIキー未設定ではボタンが無効", async ({ page }) => {
  await addTab(page, "起点のメモ\n本文", 1);
  // キー未設定 → 無効（送信自体させない）。
  await expect(page.getByTestId("search-ext-surface")).toBeDisabled();
});
