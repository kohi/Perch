import Dexie, { type Table } from "dexie";
import type { Tab } from "../types/tab";

/** キー・バリューのUI状態（最後のアクティブタブ等。screen-spec §2/§10.2）。 */
export interface MetaEntry {
  key: string;
  value: string;
}

/**
 * Perch の一時保存の「主」保存先（IndexedDB / Dexie）。
 * 揮発防止の本丸。Vault ファイル(_drafts/)は「副」（Wave 3 で追加）。
 *
 * 注: `pinned`(boolean) は IndexedDB のキーに使えないためインデックスしない。
 * ピン留めの並びはメモリ上で処理する（listTabs）。
 */
export class PerchDB extends Dexie {
  tabs!: Table<Tab, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = "perch") {
    super(name);
    this.version(1).stores({
      // id を主キー、updatedAt をインデックス（ソート用）
      tabs: "id, updatedAt",
      meta: "key",
    });
  }
}

/** アプリ全体で共有する DB インスタンス。 */
export const db = new PerchDB();
