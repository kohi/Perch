/**
 * タイトル → ファイル名 slug 化（screen-spec §6.2 / TC-403）。
 *
 * 目的:
 * - Obsidian で開けて破綻しない `.md` ファイル名を作る。
 * - Rust 側（write_note）の検証を必ず通す安全文字列にする＝区切り `/` `\`・`..`・
 *   絶対パス・空を絶対に含めない。ここが崩れると Vault 外へ書く事故に繋がるため厳格に。
 *
 * 方針:
 * - 日本語（漢字・かな）や数字などの Unicode 文字は保持する（検索性・可読性のため）。
 * - FS 敵対文字（`/ \ : * ? " < > |` と制御文字）は除去する。
 * - 空白の連続は 1 個の `-` に畳む。連続する `-` も 1 個に圧縮する。
 * - 先頭末尾の `.` と `-` は除去する（`..` 混入・隠しファイル化を防ぐ）。
 * - ASCII 英字は小文字化する（大文字小文字ゆれの回避）。
 * - コードポイント長で ~50 に丸める（長すぎるファイル名を避ける）。
 * - 結果が空になれば `"untitled"` を返す。
 */

const MAX_SLUG_CODEPOINTS = 50;

/** FS 敵対文字（パス区切り・予約記号）。 */
const HOSTILE_CHARS = /[/\\:*?"<>|]/g;
/** 制御文字（U+0000–U+001F, U+007F）。ソースにナマの制御文字を置かないため文字列から生成。 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

export function slugify(title: string): string {
  const raw = title ?? "";

  // 1) 制御文字と FS 敵対文字（区切り・`..` の素材）を除去。
  let s = raw.replace(CONTROL_CHARS, "").replace(HOSTILE_CHARS, "");

  // 2) `.` は隠しファイル化・`..` の素材になるため空白へ（区切りには一切残さない）。
  s = s.replace(/\./g, " ");

  // 3) 空白（全角含む）の連続を 1 個の `-` に。
  s = s.replace(/[\s　]+/g, "-");

  // 4) 連続する `-` を 1 個に圧縮。
  s = s.replace(/-+/g, "-");

  // 5) 先頭末尾の `-`（と念のため `.`）を除去。
  s = s.replace(/^[.-]+/, "").replace(/[.-]+$/, "");

  // 6) ASCII 英字のみ小文字化（日本語等はそのまま保持）。
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());

  // 7) コードポイント単位で丸める（サロゲートペアを壊さない）。
  const cps = Array.from(s);
  if (cps.length > MAX_SLUG_CODEPOINTS) {
    s = cps.slice(0, MAX_SLUG_CODEPOINTS).join("");
    // 丸めで末尾に `-` が残ることがあるため再度トリム。
    s = s.replace(/[.-]+$/, "");
  }

  return s.length > 0 ? s : "untitled";
}
