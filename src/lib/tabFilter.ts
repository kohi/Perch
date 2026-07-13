/**
 * タブ絞込フィルタ（純関数・非 AI・オフライン）。screen-spec S-02 「🔍タブ絞込」/ requirements §3.2。
 *
 * タイトルの部分一致でタブを絞り込む。表示のみの用途で、active/選択/DB には影響させない
 * （呼び出し側 App が表示リストにだけ適用する）。大文字小文字は無視する。
 */

import type { Tab } from "../types/tab";
import { deriveTitle } from "./title";

/**
 * タイトル部分一致でタブを絞り込む。query が空（空白のみ含む）なら全件返す。
 * 効果タイトルは表示と一致させる: t.title が空なら deriveTitle(t.body, t.createdAt)。
 */
export function filterTabsByTitle(tabs: Tab[], query: string): Tab[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return tabs;
  return tabs.filter((t) => {
    const title = t.title || deriveTitle(t.body, t.createdAt);
    return title.toLowerCase().includes(q);
  });
}
