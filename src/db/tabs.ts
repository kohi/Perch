import type { PerchDB } from "./db";
import { db as defaultDb } from "./db";
import type { Tab } from "../types/tab";
import { createTab } from "../types/tab";
import { deriveTitle } from "../lib/title";

/**
 * タブ CRUD レイヤ。すべて Promise を返し、呼び出し側（自動保存）が
 * IndexedDB へのコミット完了を await できるようにする＝揮発防止の要。
 *
 * DB を引数で注入可能にし、テストで独立インスタンスを使えるようにする。
 */

/** 全タブを取得し、ピン留め優先→updatedAt 降順で並べる（screen-spec §3.1）。 */
export async function listTabs(db: PerchDB = defaultDb): Promise<Tab[]> {
  const all = await db.tabs.toArray();
  return sortTabs(all);
}

/** 並び替えの純ロジック（テスト対象）。ピン留め優先、その中で updatedAt 降順。 */
export function sortTabs(tabs: Tab[]): Tab[] {
  return [...tabs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function getTab(id: string, db: PerchDB = defaultDb): Promise<Tab | undefined> {
  return db.tabs.get(id);
}

/** タブ全体を保存（put）。コミット完了を待つ。 */
export async function putTab(tab: Tab, db: PerchDB = defaultDb): Promise<void> {
  await db.tabs.put(tab);
}

/** 新規タブを作成して保存し、生成物を返す。 */
export async function createAndSaveTab(
  params: { id: string; now: number },
  db: PerchDB = defaultDb,
): Promise<Tab> {
  const tab = createTab(params);
  await putTab(tab, db);
  return tab;
}

/**
 * 本文更新時の自動保存。1文字ごとに呼ばれる想定。
 * title を本文1行目から再導出し、updatedAt を更新して full put する。
 * full put のため、途中の put が落ちても最新の put に全内容が入る（損失は最大1put）。
 */
export async function saveBody(
  id: string,
  body: string,
  now: number,
  db: PerchDB = defaultDb,
): Promise<Tab | undefined> {
  const existing = await db.tabs.get(id);
  if (!existing) return undefined;
  const next: Tab = {
    ...existing,
    body,
    title: deriveTitle(body, existing.createdAt),
    updatedAt: now,
  };
  await putTab(next, db);
  return next;
}

/** ピン留めトグル。 */
export async function togglePin(
  id: string,
  now: number,
  db: PerchDB = defaultDb,
): Promise<Tab | undefined> {
  const existing = await db.tabs.get(id);
  if (!existing) return undefined;
  const next: Tab = { ...existing, pinned: !existing.pinned, updatedAt: now };
  await putTab(next, db);
  return next;
}

/**
 * タブ破棄。IndexedDB から削除する。
 * TODO(Wave3): `_drafts/` の対応ファイルも同時削除する（二重保存の両方から確実に消す）。
 */
export async function deleteTab(id: string, db: PerchDB = defaultDb): Promise<void> {
  await db.tabs.delete(id);
}
