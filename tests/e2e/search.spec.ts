import { test, expect, type Page } from "@playwright/test";
import { openApp, addTab } from "./appHelpers";

/**
 * あのあれ検索（S-04）。TC-601/602/604/606 を実 DOM＋route モックで検証する。
 *
 * 実 API は叩かない：`page.route("**\/api.anthropic.com/**")` でランキング応答をモックする。
 * モックはプロンプトに埋め込まれた候補 id を読み取り、そのまま score を付けて返すので、
 * 「送信された候補が結果に反映される」実データフロー（fetch→パース→表示）を検証できる。
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

/** プロンプト末尾の「候補一覧(JSON):」以降を候補配列としてパースする。 */
function candidatesFromPrompt(userMsg: string): Array<{ id: string; title: string }> {
  const marker = "候補一覧(JSON):";
  const idx = userMsg.lastIndexOf(marker);
  if (idx === -1) return [];
  const jsonPart = userMsg.slice(idx + marker.length).trim();
  try {
    return JSON.parse(jsonPart) as Array<{ id: string; title: string }>;
  } catch {
    return [];
  }
}

/**
 * api.anthropic.com をモックする。ranker(candidates) が返した [{id,score}] を
 * Anthropic Messages 応答形（content[].text = JSON 文字列）に包んで返す。
 */
async function mockClaude(
  page: Page,
  ranker: (cands: Array<{ id: string; title: string }>) => Array<{ id: string; score: number }>,
): Promise<void> {
  await page.route("**/api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const post = req.postDataJSON() as { messages?: Array<{ content?: string }> };
    const userMsg = post.messages?.[0]?.content ?? "";
    const ranking = ranker(candidatesFromPrompt(userMsg));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(ranking) }] }),
    });
  });
}

/** 設定モーダル経由で API キーを設定する（AI 機能を有効化）。 */
async function setApiKey(page: Page, key: string): Promise<void> {
  await page.getByTestId("settings-open").click();
  await page.getByTestId("settings-apikey").fill(key);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("TC-606: APIキー未設定で検索すると『設定でキーを』と案内し、導線が出る", async ({ page }) => {
  await expect(page.getByTestId("searchbar")).toBeVisible();
  await page.getByTestId("search-input").fill("税金の話どっかでしたよね");
  await page.getByTestId("search-run").click();

  await expect(page.getByTestId("search-nokey")).toBeVisible();
  // 設定導線が機能する
  await page.getByTestId("search-open-settings").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
});

test("TC-601/602: モック応答で結果が出て、タブ結果クリックでそのタブが開く", async ({ page }) => {
  // 候補の title に応じてスコアを付与（アルファを最上位に）。
  await mockClaude(page, (cands) =>
    cands.map((c) => ({ id: c.id, score: c.title.includes("アルファ") ? 0.95 : 0.3 })),
  );

  // タブを2つ用意（別内容）。
  await addTab(page, "アルファのメモ\n税金の話をした", 1);
  await addTab(page, "ベータのメモ\n買い物リスト", 2);

  // API キーを設定して検索を有効化。
  await setApiKey(page, "sk-e2e-search");

  await page.getByTestId("search-input").fill("税金どこかで話した");
  await page.getByTestId("search-run").click();

  // 結果が実 DOM に出る（2件、タブ所在）。
  const results = page.getByTestId("search-result");
  await expect(results).toHaveCount(2);
  // 最上位はアルファ（スコア降順ソートの実証）。
  await expect(results.first()).toContainText("アルファのメモ");
  await expect(results.first().getByText("タブ")).toBeVisible();

  // アルファのメモは今アクティブではない（直近作成のベータがアクティブ）。
  await expect(page.locator(".cm-content")).toContainText("ベータのメモ");

  // タブ結果クリック → そのタブがエディタで開く（TC-602）。
  await results.first().click();
  await expect(page.locator(".cm-content")).toContainText("アルファのメモ");
  await expect(page.locator(".cm-content")).toContainText("税金の話をした");
});

test("TC-604: モックが空応答なら『近いメモが見つからなかった』", async ({ page }) => {
  await mockClaude(page, () => []); // 何も一致させない

  await addTab(page, "無関係なメモ\n本文", 1);
  await setApiKey(page, "sk-e2e-empty");

  await page.getByTestId("search-input").fill("存在しない話題");
  await page.getByTestId("search-run").click();

  await expect(page.getByTestId("search-empty")).toBeVisible();
  await expect(page.getByTestId("search-empty")).toContainText("近いメモが見つからなかった");
});
