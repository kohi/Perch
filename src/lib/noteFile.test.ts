import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  draftFilename,
  inboxFilename,
  toJstIso,
  buildNoteMarkdown,
} from "./noteFile";

/**
 * TC-403/404 の実検証。偽装なし：生成 Markdown を実 YAML パーサでパースし、
 * frontmatter の各フィールドと本文の実体を assert する。
 */

/** frontmatter と body を分離する（先頭 `---` ブロック）。 */
function splitFrontmatter(md: string): { fm: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error("frontmatter block not found");
  }
  const fm = parseYaml(m[1]) as Record<string, unknown>;
  return { fm, body: m[2] };
}

// 2026-06-29 14:30:00 JST = 2026-06-29T05:30:00Z
const JST_29_1430 = Date.UTC(2026, 5, 29, 5, 30, 0);

describe("draftFilename", () => {
  it("tabId.md を返す", () => {
    expect(draftFilename("abc-123")).toBe("abc-123.md");
  });
});

describe("toJstIso", () => {
  it("+09:00 固定の ISO8601 に整形する", () => {
    expect(toJstIso(JST_29_1430)).toBe("2026-06-29T14:30:00+09:00");
  });

  it("UTC 深夜でも JST の日付繰り上げが反映される", () => {
    // 2026-06-29T20:00:00Z = 2026-06-30T05:00:00 JST
    const t = Date.UTC(2026, 5, 29, 20, 0, 0);
    expect(toJstIso(t)).toBe("2026-06-30T05:00:00+09:00");
  });
});

describe("inboxFilename", () => {
  it("YYYY-MM-DD-slug.md（日付は JST）", () => {
    expect(inboxFilename("確定申告のメモ", JST_29_1430)).toBe("2026-06-29-確定申告のメモ.md");
  });

  it("記号・区切りを含むタイトルでもファイル名が破綻しない（TC-403）", () => {
    const name = inboxFilename("a/b: プロジェクト? *メモ*", JST_29_1430);
    expect(name.endsWith(".md")).toBe(true);
    // 日付部を除いた slug 部に区切り・親参照が無いこと
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^2026-06-29-/);
  });

  it("空タイトルは untitled にフォールバック", () => {
    expect(inboxFilename("   ", JST_29_1430)).toBe("2026-06-29-untitled.md");
  });
});

describe("buildNoteMarkdown（TC-404: YAML を実パースして検証）", () => {
  it("title/created/source/tags と本文を正しく出力する", () => {
    const md = buildNoteMarkdown({
      title: "確定申告のメモ",
      body: "本文1行目\n本文2行目",
      createdAt: JST_29_1430,
      tags: ["code/html", "2026-06", "税金"],
    });
    const { fm, body } = splitFrontmatter(md);
    expect(fm.title).toBe("確定申告のメモ");
    expect(fm.created).toBe("2026-06-29T14:30:00+09:00");
    expect(fm.source).toBe("perch");
    expect(fm.tags).toEqual(["code/html", "2026-06", "税金"]);
    // 本文が frontmatter の後に続く（空行区切り）
    expect(body).toBe("本文1行目\n本文2行目");
  });

  it("確定タグが空なら tags: [] を出力する", () => {
    const md = buildNoteMarkdown({
      title: "無題",
      body: "",
      createdAt: JST_29_1430,
      tags: [],
    });
    const { fm } = splitFrontmatter(md);
    expect(fm.tags).toEqual([]);
    expect(Array.isArray(fm.tags)).toBe(true);
  });

  it("ダブルクオート・バックスラッシュを含むタイトルを正しくエスケープする", () => {
    const md = buildNoteMarkdown({
      title: 'これは"引用"と\\バックスラッシュ',
      body: "x",
      createdAt: JST_29_1430,
      tags: [],
    });
    const { fm } = splitFrontmatter(md);
    // パースして元の文字列に戻ること（エスケープが正しい証拠）
    expect(fm.title).toBe('これは"引用"と\\バックスラッシュ');
  });

  it("frontmatter が先頭、本文がその後に続く順序である", () => {
    const md = buildNoteMarkdown({
      title: "順序テスト",
      body: "ボディ",
      createdAt: JST_29_1430,
      tags: [],
    });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md.indexOf("---\n\n")).toBeGreaterThan(0); // 終端 --- の後に空行→body
    expect(md.trimEnd().endsWith("ボディ")).toBe(true);
  });
});
