import { describe, expect, it } from "vitest";
import { deriveTitle } from "./title";

describe("deriveTitle", () => {
  it("本文1行目をタイトルに採用する", () => {
    expect(deriveTitle("買い物リスト\n牛乳\n卵", 0)).toBe("買い物リスト");
  });

  it("1行目の前後空白をトリムする", () => {
    expect(deriveTitle("  税金メモ  \n本文", 0)).toBe("税金メモ");
  });

  it("1行目が空なら『無題 HH:MM』を返す", () => {
    // 2026-06-29T14:30:00+09:00 相当のローカル時刻を作る
    const ts = new Date(2026, 5, 29, 14, 30, 0).getTime();
    expect(deriveTitle("\n本文だけ", ts)).toBe("無題 14:30");
    expect(deriveTitle("", ts)).toBe("無題 14:30");
  });

  it("80文字を超える1行目は丸める", () => {
    const long = "あ".repeat(100);
    const title = deriveTitle(long, 0);
    expect(title.endsWith("…")).toBe(true);
    expect([...title].length).toBe(81); // 80文字 + …
  });
});
