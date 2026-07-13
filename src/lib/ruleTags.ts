/**
 * ルールベース自動タグ（純関数）。requirements §6.5 ①/ screen-spec / TC-501〜503。
 *
 * 本文を機械的に走査して即付与する高速・オフラインのタグ。Claude API 不要。
 * ここで返すのは `#` を付けない **素の文字列**（YAML は `tags: [code/html, link, 2026-07]`）。
 *
 * ルール:
 *  - フェンス ```html            → code/html
 *  - フェンス ```js / ```javascript → code/js
 *  - フェンス ```css             → code/css
 *  - URL（http(s)://…）を含む     → link
 *  - 昇格月（epochMs を JST 換算） → YYYY-MM（例 2026-07）
 *
 * 昇格時刻は epochMs で注入し実行時刻に依存させない（テスト決定性）。
 * JST 換算は noteFile.ts と同じ +9h 方式で整合させる。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** epoch(ms) を JST の `YYYY-MM` に整形（noteFile.ts の JST 換算と整合）。 */
function jstMonthTag(epochMs: number): string {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/**
 * 本文からルールベースの確定タグを機械的に導出する。
 * 順序は決定的（code/html → code/js → code/css → link → 月）。重複は除去する。
 */
export function ruleTags(body: string, epochMs: number): string[] {
  const tags: string[] = [];

  // フェンス言語を収集（```lang の lang 部分を小文字化して集合に）。
  // 開きフェンス直後の言語トークンのみを見る（英数字の連なり）。
  const fenceLangs = new Set<string>();
  const fenceRe = /```([a-zA-Z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(body)) !== null) {
    const lang = m[1];
    if (lang) fenceLangs.add(lang.toLowerCase());
  }
  if (fenceLangs.has("html")) tags.push("code/html");
  if (fenceLangs.has("js") || fenceLangs.has("javascript")) tags.push("code/js");
  if (fenceLangs.has("css")) tags.push("code/css");

  // URL を含むか（http:// または https://）。
  if (/https?:\/\/\S+/i.test(body)) tags.push("link");

  // 昇格月（JST）。
  tags.push(jstMonthTag(epochMs));

  // 重複除去（挿入順を保持 = 決定的）。
  return Array.from(new Set(tags));
}
