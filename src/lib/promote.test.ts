import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildPromotion } from "./promote";
import { createTab, type Tab } from "../types/tab";

/**
 * TC-401/404/406 相当（決定ロジック）。偽装なし：生成 content を実 YAML パースして検証。
 */

function splitFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error("frontmatter block not found");
  }
  return { fm: parseYaml(m[1]) as Record<string, unknown>, body: m[2] };
}

// 2026-06-29 09:00:00 JST（作成時刻）
const CREATED = Date.UTC(2026, 5, 29, 0, 0, 0);
// 昇格実行時刻 2026-07-12 12:00:00 JST
const PROMOTE_AT = Date.UTC(2026, 6, 12, 3, 0, 0);

function makeTab(overrides: Partial<Tab>): Tab {
  return { ...createTab({ id: "t1", now: CREATED }), ...overrides };
}

describe("buildPromotion", () => {
  it("filename は昇格時刻の YYYY-MM-DD ＋ タイトル slug", () => {
    const tab = makeTab({ title: "確定申告のメモ", body: "確定申告のメモ\n本文" });
    const { filename } = buildPromotion(tab, PROMOTE_AT);
    expect(filename).toBe("2026-07-12-確定申告のメモ.md");
  });

  it("content の YAML に title/created/source/tags（確定タグのみ）が入る", () => {
    const tab = makeTab({
      title: "会議メモ",
      body: "会議メモ\n議事本文",
      tags: ["code/html", "2026-06"],
      suggestedTags: [{ name: "未承認タグ", confidence: 0.5 }],
    });
    const { content } = buildPromotion(tab, PROMOTE_AT);
    const { fm, body } = splitFrontmatter(content);
    expect(fm.title).toBe("会議メモ");
    // created は昇格時刻ではなく作成時刻（CREATED）由来
    expect(fm.created).toBe("2026-06-29T09:00:00+09:00");
    expect(fm.source).toBe("perch");
    expect(fm.tags).toEqual(["code/html", "2026-06"]);
    // suggestedTags は YAML に書き出されない（TC-509 の土台）
    expect(JSON.stringify(fm.tags)).not.toContain("未承認タグ");
    expect(content).not.toContain("未承認タグ");
    expect(body).toBe("会議メモ\n議事本文");
  });

  it("title 未設定なら本文1行目から導出する", () => {
    const tab = makeTab({ title: "", body: "本文の1行目です\n2行目" });
    const { filename, content } = buildPromotion(tab, PROMOTE_AT);
    expect(filename).toBe("2026-07-12-本文の1行目です.md");
    const { fm } = splitFrontmatter(content);
    expect(fm.title).toBe("本文の1行目です");
  });

  it("確定タグが空なら tags: [] を出力", () => {
    const tab = makeTab({ title: "空タグ", body: "空タグ", tags: [] });
    const { content } = buildPromotion(tab, PROMOTE_AT);
    const { fm } = splitFrontmatter(content);
    expect(fm.tags).toEqual([]);
  });
});
