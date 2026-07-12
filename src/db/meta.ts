import type { PerchDB } from "./db";
import { db as defaultDb } from "./db";

/** UI 状態（最後のアクティブタブ等）の永続化。screen-spec §10.2。 */

const ACTIVE_TAB_KEY = "activeTabId";

export async function setActiveTabId(id: string | null, db: PerchDB = defaultDb): Promise<void> {
  if (id === null) {
    await db.meta.delete(ACTIVE_TAB_KEY);
  } else {
    await db.meta.put({ key: ACTIVE_TAB_KEY, value: id });
  }
}

export async function getActiveTabId(db: PerchDB = defaultDb): Promise<string | null> {
  const entry = await db.meta.get(ACTIVE_TAB_KEY);
  return entry?.value ?? null;
}
