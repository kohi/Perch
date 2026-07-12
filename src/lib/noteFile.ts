/**
 * Vault 書き出し用のファイル名・Markdown 生成（純関数）。screen-spec §6.2 / TC-403/404。
 *
 * - `_drafts/` は tabId をそのままファイル名にする（安定・衝突しない）。
 * - `inbox/` は `YYYY-MM-DD-slug.md`（日付は JST）。
 * - YAML frontmatter は `title` / `created` / `source` / `tags` を出力。確定タグのみ。
 *
 * すべて epoch(ms) を引数で受け取り、実行時刻に依存しない（テスト決定性）。
 */

import { slugify } from "./slug";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** epoch(ms) を JST の各成分に分解する。UTC 基準に +9h して getUTC* で読む。 */
function jstParts(epochMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `_drafts/` の副保存ファイル名。tabId は uuid 想定で安全。 */
export function draftFilename(tabId: string): string {
  return `${tabId}.md`;
}

/** `inbox/` 昇格ファイル名。`YYYY-MM-DD-slug.md`（日付は JST）。 */
export function inboxFilename(title: string, epochMs: number): string {
  const { year, month, day } = jstParts(epochMs);
  return `${year}-${pad2(month)}-${pad2(day)}-${slugify(title)}.md`;
}

/** epoch(ms) を JST の ISO8601（`+09:00` 固定）に整形する。例: 2026-06-29T14:30:00+09:00。 */
export function toJstIso(epochMs: number): string {
  const { year, month, day, hour, minute, second } = jstParts(epochMs);
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+09:00`;
}

/** YAML 二重引用符文字列のエスケープ（`\` と `"`）。 */
function yamlDquote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface BuildNoteMarkdownParams {
  title: string;
  body: string;
  /** epoch(ms)。created に JST ISO で出力。 */
  createdAt: number;
  /** 確定タグのみ。未承認 suggestedTags はここに渡さない（YAML に出さない）。 */
  tags: string[];
}

/**
 * YAML frontmatter ＋ 空行 ＋ 本文の Markdown を生成する。
 * `tags` は確定タグのみ。空なら `tags: []`。source は固定 `perch`。
 */
export function buildNoteMarkdown(params: BuildNoteMarkdownParams): string {
  const { title, body, createdAt, tags } = params;
  const tagsLine =
    tags.length === 0 ? "tags: []" : `tags: [${tags.map((t) => yamlDquote(t)).join(", ")}]`;
  const frontmatter = [
    "---",
    `title: ${yamlDquote(title)}`,
    `created: ${toJstIso(createdAt)}`,
    "source: perch",
    tagsLine,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${body}`;
}
