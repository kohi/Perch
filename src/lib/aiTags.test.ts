import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { splitByConfidence } from "./aiTags";
import { buildPromotion } from "./promote";
import { createTab } from "../types/tab";

/**
 * TC-504/505/510 の実検証。splitByConfidence は純関数なので入力→出力を直接 assert する。
 * 境界（0.8 ちょうどは確定・0.79 は提案）としきい値変更の反映を実値で確認する（偽装なし）。
 */

const SUGGESTIONS = [
  { name: "税金", confidence: 0.9 },
  { name: "確定申告", confidence: 0.8 },
  { name: "経費", confidence: 0.79 },
  { name: "雑記", confidence: 0.3 },
];

describe("splitByConfidence: 境界（TC-504/505）", () => {
  it("既定 0.8: >=0.8 は確定・<0.8 は提案（0.8 ちょうどは確定側）", () => {
    const { confirmed, suggested } = splitByConfidence(SUGGESTIONS, 0.8);
    expect(confirmed).toEqual(["税金", "確定申告"]);
    expect(suggested.map((s) => s.name)).toEqual(["経費", "雑記"]);
  });

  it("0.79 は 0.8 しきい値では確定に入らない（提案止まり）", () => {
    const { confirmed, suggested } = splitByConfidence(
      [{ name: "経費", confidence: 0.79 }],
      0.8,
    );
    expect(confirmed).toEqual([]);
    expect(suggested).toEqual([{ name: "経費", confidence: 0.79 }]);
  });

  it("提案側は confidence を保持する（UI の承認/却下に使う）", () => {
    const { suggested } = splitByConfidence(SUGGESTIONS, 0.8);
    expect(suggested).toEqual([
      { name: "経費", confidence: 0.79 },
      { name: "雑記", confidence: 0.3 },
    ]);
  });
});

describe("splitByConfidence: しきい値変更の反映（TC-510）", () => {
  it("0.5 に下げると 0.79 が確定側へ移る", () => {
    const { confirmed, suggested } = splitByConfidence(SUGGESTIONS, 0.5);
    expect(confirmed).toEqual(["税金", "確定申告", "経費"]);
    expect(suggested.map((s) => s.name)).toEqual(["雑記"]);
  });

  it("1.0 まで上げると 0.9 すら提案止まりになる", () => {
    const { confirmed } = splitByConfidence(SUGGESTIONS, 1.0);
    expect(confirmed).toEqual([]);
  });

  it("0 まで下げると全て確定になる", () => {
    const { confirmed, suggested } = splitByConfidence(SUGGESTIONS, 0);
    expect(confirmed).toEqual(["税金", "確定申告", "経費", "雑記"]);
    expect(suggested).toEqual([]);
  });
});

describe("splitByConfidence: 頑健性", () => {
  it("確定側の同名は重複除去（挿入順を保持）", () => {
    const { confirmed } = splitByConfidence(
      [
        { name: "税金", confidence: 0.9 },
        { name: "税金", confidence: 0.95 },
        { name: "経費", confidence: 0.85 },
      ],
      0.8,
    );
    expect(confirmed).toEqual(["税金", "経費"]);
  });

  it("空・空白名は無視する", () => {
    const { confirmed, suggested } = splitByConfidence(
      [
        { name: "  ", confidence: 0.9 },
        { name: "", confidence: 0.2 },
        { name: " 税金 ", confidence: 0.9 },
      ],
      0.8,
    );
    expect(confirmed).toEqual(["税金"]);
    expect(suggested).toEqual([]);
  });

  it("空配列は空の結果", () => {
    expect(splitByConfidence([], 0.8)).toEqual({ confirmed: [], suggested: [] });
  });
});

describe("TC-509: YAML に確定タグのみ出力（未承認提案は書き出さない）", () => {
  // 昇格時刻 2026-07-12 12:00 JST
  const PROMOTE_AT = Date.UTC(2026, 6, 12, 3, 0, 0);

  it("提案タグを承認せず昇格すると tags: に確定タグだけが載る", () => {
    // AI 応答（confidence 混在）をしきい値 0.8 で振り分け。
    const { confirmed, suggested } = splitByConfidence(
      [
        { name: "税金", confidence: 0.9 }, // 自動確定
        { name: "確定申告", confidence: 0.5 }, // 提案止まり（未承認）
      ],
      0.8,
    );
    // ルール＋手動＋自動確定を確定タグとして昇格に渡す（提案は渡さない）。
    const finalTags = ["code/html", "2026-07", ...confirmed];

    const tab = {
      ...createTab({ id: "t509", now: Date.UTC(2026, 5, 29, 0, 0, 0) }),
      title: "確定申告メモ",
      body: "確定申告メモ\n```html\n<p>x</p>\n```",
      tags: finalTags,
    };

    const { content } = buildPromotion(tab, PROMOTE_AT);

    // 実 YAML パースして tags を検証（DB でなく生成 md の中身）。
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = m?.[1];
    expect(frontmatter).toBeDefined();
    const fm = parseYaml(frontmatter as string) as { tags: string[] };

    expect(fm.tags).toEqual(["code/html", "2026-07", "税金"]);
    // 未承認提案は確定タグ（YAML tags）に現れない。
    expect(fm.tags).not.toContain("確定申告");
    // だが提案としては保持されている（承認待ち・別管理）。
    expect(suggested.map((s) => s.name)).toContain("確定申告");
    // confidence 値そのものが YAML に漏れていない。
    expect(frontmatter).not.toContain("confidence");
  });
});
