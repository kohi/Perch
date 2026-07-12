/**
 * Vault 昇格の決定ロジック（純関数）。screen-spec §6 / TC-401/404/406。
 *
 * タブと昇格時刻から `inbox/` の {ファイル名, 内容} を組む。副作用（FS 書き込み・
 * DB 更新）は呼び出し側（App）が担当し、ここは決定論的に保ってテスト可能にする。
 *
 * - ファイル名: `YYYY-MM-DD-slug.md`（日付は JST・slug は安全文字列）。
 * - 内容: YAML frontmatter（title/created/source/tags）＋ 本文。
 * - YAML の tags は **確定タグ（tab.tags）のみ**。suggestedTags は書き出さない。
 * - created は昇格時刻ではなくタブ作成時刻（createdAt）を用いる。
 */

import type { Tab } from "../types/tab";
import { deriveTitle } from "./title";
import { inboxFilename, buildNoteMarkdown } from "./noteFile";

export interface Promotion {
  filename: string;
  content: string;
}

/**
 * 昇格ペイロードを組む。title はタブ由来（未設定なら本文1行目から導出）。
 * epochMs はファイル名の日付算出に使う（通常 Date.now()）。
 */
export function buildPromotion(tab: Tab, epochMs: number): Promotion {
  const title = tab.title.trim().length > 0 ? tab.title : deriveTitle(tab.body, tab.createdAt);
  const filename = inboxFilename(title, epochMs);
  const content = buildNoteMarkdown({
    title,
    body: tab.body,
    createdAt: tab.createdAt,
    tags: tab.tags, // 確定タグのみ（suggestedTags は含めない）
  });
  return { filename, content };
}
