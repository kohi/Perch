/**
 * エディタのフォントサイズ純ロジック（S-03 §4.1 / TC-306・307）。
 * 値の永続化は db/meta.ts、UI は App.tsx。ここは決定的な純関数のみ。
 */
export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 28;
export const FONT_SIZE_STEP = 2;

/** 範囲 [MIN, MAX] に丸める。NaN は既定にフォールバック。 */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
  if (n < MIN_FONT_SIZE) return MIN_FONT_SIZE;
  if (n > MAX_FONT_SIZE) return MAX_FONT_SIZE;
  return n;
}

/** 現在値から 1 段拡大(dir=1)/縮小(dir=-1)。MIN/MAX で頭打ち。 */
export function stepFontSize(current: number, dir: 1 | -1): number {
  return clampFontSize(clampFontSize(current) + dir * FONT_SIZE_STEP);
}
