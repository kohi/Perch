/**
 * 本文からタブタイトルを導出する純関数（screen-spec §3.3）。
 * 1行目を採用。1行目が空なら「無題」＋作成時刻。
 */
export function deriveTitle(body: string, createdAt: number): string {
  const firstLine = body.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length > 0) {
    // 一覧表示が破綻しないよう長すぎる場合は丸める
    return firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
  }
  const d = new Date(createdAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `無題 ${hh}:${mm}`;
}
