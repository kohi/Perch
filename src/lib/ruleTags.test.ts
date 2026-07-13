import { describe, expect, it } from "vitest";
import { ruleTags } from "./ruleTags";

/**
 * TC-501/502/503 の実検証。ruleTags は純関数なので入力→出力を直接 assert する。
 * epochMs は固定注入し実行時刻に依存させない。`#` を付けない素の文字列で返ること、
 * 各ルール・複数同時・重複除去・月タグを実値で確認する（偽装なし）。
 */

// 2026-07-13 12:00 JST = 2026-07-13T03:00:00Z
const JST_2026_07 = Date.UTC(2026, 6, 13, 3, 0, 0);

describe("ruleTags: コードフェンス（TC-501）", () => {
  it("```html → code/html（# は付けない素の文字列）", () => {
    const t = ruleTags("メモ\n```html\n<p>hi</p>\n```", JST_2026_07);
    expect(t).toContain("code/html");
    expect(t.some((x) => x.startsWith("#"))).toBe(false);
  });

  it("```js → code/js", () => {
    expect(ruleTags("```js\nconst a=1;\n```", JST_2026_07)).toContain("code/js");
  });

  it("```javascript も code/js に正規化される", () => {
    expect(ruleTags("```javascript\nlet b=2;\n```", JST_2026_07)).toContain("code/js");
  });

  it("```css → code/css", () => {
    expect(ruleTags("```css\n.x{color:red}\n```", JST_2026_07)).toContain("code/css");
  });

  it("大文字フェンス ```HTML も小文字化して code/html", () => {
    expect(ruleTags("```HTML\n<b>x</b>\n```", JST_2026_07)).toContain("code/html");
  });

  it("該当言語が無ければコードタグは付かない", () => {
    const t = ruleTags("```python\nprint(1)\n```", JST_2026_07);
    expect(t).not.toContain("code/html");
    expect(t).not.toContain("code/js");
    expect(t).not.toContain("code/css");
  });
});

describe("ruleTags: URL（TC-502）", () => {
  it("https URL を含む → link", () => {
    expect(ruleTags("参考 https://example.com/a?b=1 を見て", JST_2026_07)).toContain("link");
  });

  it("http URL でも link", () => {
    expect(ruleTags("http://localhost:3000 で確認", JST_2026_07)).toContain("link");
  });

  it("URL が無ければ link は付かない", () => {
    expect(ruleTags("ただのテキスト example.com は裸ドメイン", JST_2026_07)).not.toContain("link");
  });
});

describe("ruleTags: 月タグ（TC-503・JST）", () => {
  it("昇格月を YYYY-MM で付与する", () => {
    expect(ruleTags("本文", JST_2026_07)).toContain("2026-07");
  });

  it("UTC 深夜でも JST の月繰り上げが反映される", () => {
    // 2026-07-31T20:00:00Z = 2026-08-01 05:00 JST → 2026-08
    const t = ruleTags("x", Date.UTC(2026, 6, 31, 20, 0, 0));
    expect(t).toContain("2026-08");
    expect(t).not.toContain("2026-07");
  });
});

describe("ruleTags: 複数同時・重複除去・順序", () => {
  it("html/url/月を同時に付与し、決定的な順序で返す", () => {
    const body = "```html\n<a href=\"https://example.com\">x</a>\n```";
    const t = ruleTags(body, JST_2026_07);
    expect(t).toEqual(["code/html", "link", "2026-07"]);
  });

  it("同じフェンス言語が複数あっても重複しない", () => {
    const body = "```js\na\n```\nテキスト\n```js\nb\n```";
    const t = ruleTags(body, JST_2026_07);
    expect(t.filter((x) => x === "code/js")).toHaveLength(1);
  });

  it("html/js/css を全部含むと決定順で並ぶ", () => {
    const body = "```html\n<b>x</b>\n```\n```js\n1\n```\n```css\n.a{}\n```";
    const t = ruleTags(body, JST_2026_07);
    expect(t).toEqual(["code/html", "code/js", "code/css", "2026-07"]);
  });

  it("該当ルールが無くても月タグだけは必ず付く", () => {
    expect(ruleTags("", JST_2026_07)).toEqual(["2026-07"]);
  });
});
