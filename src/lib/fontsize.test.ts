import { describe, expect, it } from "vitest";
import {
  clampFontSize,
  stepFontSize,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  FONT_SIZE_STEP,
} from "./fontsize";

describe("clampFontSize", () => {
  it("下限未満は MIN に丸める", () => {
    expect(clampFontSize(MIN_FONT_SIZE - 1)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(0)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(-100)).toBe(MIN_FONT_SIZE);
  });

  it("上限超過は MAX に丸める", () => {
    expect(clampFontSize(MAX_FONT_SIZE + 1)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(9999)).toBe(MAX_FONT_SIZE);
  });

  it("範囲内はそのまま返す（境界含む）", () => {
    expect(clampFontSize(MIN_FONT_SIZE)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(MAX_FONT_SIZE)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(DEFAULT_FONT_SIZE)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(20)).toBe(20);
  });

  it("NaN / Infinity は既定にフォールバック", () => {
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(Infinity)).toBe(DEFAULT_FONT_SIZE);
  });
});

describe("stepFontSize", () => {
  it("拡大は STEP 分増える", () => {
    expect(stepFontSize(14, 1)).toBe(14 + FONT_SIZE_STEP);
  });

  it("縮小は STEP 分減る", () => {
    expect(stepFontSize(14, -1)).toBe(14 - FONT_SIZE_STEP);
  });

  it("MAX 付近の拡大は MAX で頭打ち", () => {
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE);
    expect(stepFontSize(MAX_FONT_SIZE - 1, 1)).toBe(MAX_FONT_SIZE);
  });

  it("MIN 付近の縮小は MIN で頭打ち", () => {
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE);
    expect(stepFontSize(MIN_FONT_SIZE + 1, -1)).toBe(MIN_FONT_SIZE);
  });

  it("既定から数回拡大→縮小して境界と往復が整合する", () => {
    let s = DEFAULT_FONT_SIZE;
    s = stepFontSize(s, 1); // 16
    s = stepFontSize(s, 1); // 18
    expect(s).toBe(18);
    s = stepFontSize(s, -1); // 16
    s = stepFontSize(s, -1); // 14
    expect(s).toBe(DEFAULT_FONT_SIZE);
  });
});
