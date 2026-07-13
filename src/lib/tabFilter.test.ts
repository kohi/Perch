import { describe, expect, it } from "vitest";
import { filterTabsByTitle } from "./tabFilter";
import { createTab, type Tab } from "../types/tab";

/**
 * タブ絞込フィルタの実検証（純関数）。部分一致・大文字小文字無視・空クエリ全件・
 * タイトル空タブは deriveTitle ベースで一致することを assert（偽装なし）。
 */

const NOW = Date.UTC(2026, 5, 29, 5, 30, 0);

/** title/body を指定して Tab を作る（createTab で決定的に生成）。 */
function tab(id: string, title: string, body: string): Tab {
  return { ...createTab({ id, now: NOW }), title, body };
}

describe("filterTabsByTitle", () => {
  const tabs: Tab[] = [
    tab("t1", "税金の話", "本文1"),
    tab("t2", "買い物リスト", "本文2"),
    tab("t3", "TypeScript メモ", "本文3"),
  ];

  it("タイトル部分一致で絞り込む", () => {
    const r = filterTabsByTitle(tabs, "税金");
    expect(r.map((t) => t.id)).toEqual(["t1"]);
  });

  it("大文字小文字を無視する", () => {
    expect(filterTabsByTitle(tabs, "typescript").map((t) => t.id)).toEqual(["t3"]);
    expect(filterTabsByTitle(tabs, "TYPESCRIPT").map((t) => t.id)).toEqual(["t3"]);
  });

  it("空クエリ・空白のみは全件返す", () => {
    expect(filterTabsByTitle(tabs, "")).toHaveLength(3);
    expect(filterTabsByTitle(tabs, "   ")).toHaveLength(3);
  });

  it("一致なしは空配列", () => {
    expect(filterTabsByTitle(tabs, "存在しない")).toEqual([]);
  });

  it("タイトル空タブは deriveTitle（本文1行目）ベースで一致する", () => {
    const untitled = tab("t4", "", "会議メモ\n詳細本文");
    const r = filterTabsByTitle([untitled], "会議");
    expect(r.map((t) => t.id)).toEqual(["t4"]);
    // 2行目（本文）はタイトル導出対象外なので一致しない。
    expect(filterTabsByTitle([untitled], "詳細本文")).toEqual([]);
  });
});
