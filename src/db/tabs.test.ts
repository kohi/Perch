import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerchDB } from "./db";
import {
  createAndSaveTab,
  deleteTab,
  getTab,
  listTabs,
  putTab,
  saveBody,
  sortTabs,
  togglePin,
} from "./tabs";
import { getActiveTabId, setActiveTabId } from "./meta";
import { createTab } from "../types/tab";

let db: PerchDB;
let counter = 0;

beforeEach(() => {
  // テストごとに独立した実 IndexedDB(fake-indexeddb) を使う
  db = new PerchDB(`perch-test-${counter++}`);
});

afterEach(async () => {
  await db.delete();
});

describe("TC-101 相当: 自動保存が IndexedDB に反映される", () => {
  it("saveBody 後に DB から読み戻すと本文・タイトル・updatedAt が一致する", async () => {
    const tab = await createAndSaveTab({ id: "a", now: 1000 }, db);
    expect(tab.body).toBe("");

    const saved = await saveBody("a", "確定申告\nメモ本文", 2000, db);
    expect(saved).toBeDefined();

    // DB を直接読み戻して副作用を検証（true 固定ではない実検証）
    const fromDb = await getTab("a", db);
    expect(fromDb?.body).toBe("確定申告\nメモ本文");
    expect(fromDb?.title).toBe("確定申告"); // 1行目から導出
    expect(fromDb?.updatedAt).toBe(2000);
    expect(fromDb?.createdAt).toBe(1000); // createdAt は不変
  });

  it("存在しない id への saveBody は undefined を返し何も書かない", async () => {
    const r = await saveBody("nope", "x", 1, db);
    expect(r).toBeUndefined();
    expect(await db.tabs.count()).toBe(0);
  });
});

describe("TC-102 相当: 別 DB インスタンスで全タブが復元される", () => {
  it("12タブ（一部ピン）を保存し、同名 DB を開き直すと内容・順序・ピンが復元される", async () => {
    const name = `perch-restore-${counter++}`;
    const writer = new PerchDB(name);
    for (let i = 0; i < 12; i++) {
      const t = createTab({ id: `t${i}`, now: 1000 + i });
      t.body = `メモ${i}`;
      t.title = `メモ${i}`;
      if (i === 3 || i === 7) t.pinned = true;
      await putTab(t, writer);
    }
    writer.close();

    // 「再起動」相当: 新しいインスタンスで開き直して読む
    const reader = new PerchDB(name);
    const restored = await listTabs(reader);

    expect(restored).toHaveLength(12);
    // ピン留めが先頭2件
    expect(restored.slice(0, 2).every((t) => t.pinned)).toBe(true);
    // ピンは updatedAt 降順（t7 が t3 より新しい）
    expect(restored[0]?.id).toBe("t7");
    expect(restored[1]?.id).toBe("t3");
    // 内容一致
    const t5 = restored.find((t) => t.id === "t5");
    expect(t5?.body).toBe("メモ5");

    await reader.delete();
  });
});

describe("sortTabs: ピン優先→updatedAt 降順", () => {
  it("並び順が仕様通り", () => {
    const mk = (id: string, updatedAt: number, pinned: boolean) => ({
      ...createTab({ id, now: 0 }),
      updatedAt,
      pinned,
    });
    const sorted = sortTabs([
      mk("old", 100, false),
      mk("pinOld", 100, true),
      mk("new", 300, false),
      mk("pinNew", 200, true),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["pinNew", "pinOld", "new", "old"]);
  });
});

describe("TC-107 相当: 1文字ごとの full put で損失は最大1put", () => {
  it("連続入力の各段階で DB は常にその時点の全文を保持する", async () => {
    await createAndSaveTab({ id: "typing", now: 0 }, db);
    const target = "税金の話をどこかでした";
    let acc = "";
    for (const ch of target) {
      acc += ch;
      // 1文字ごとに保存し、コミット完了を待つ（await = 揮発防止の要）
      await saveBody("typing", acc, acc.length, db);
      // その瞬間に DB を読むと、常にそこまでの全文が入っている
      const now = await getTab("typing", db);
      expect(now?.body).toBe(acc);
    }
    const final = await getTab("typing", db);
    expect(final?.body).toBe(target);
    expect(final?.createdAt).toBe(0); // createdAt は連続保存でも不変
  });
});

describe("TC-106 相当（IndexedDB 部分）: 破棄で DB から消える", () => {
  it("deleteTab 後に getTab が undefined になる", async () => {
    await createAndSaveTab({ id: "gone", now: 0 }, db);
    expect(await getTab("gone", db)).toBeDefined();
    await deleteTab("gone", db);
    expect(await getTab("gone", db)).toBeUndefined();
    expect(await db.tabs.count()).toBe(0);
  });
});

describe("ピン留めトグルの永続化", () => {
  it("togglePin で pinned が反転し DB に残る", async () => {
    await createAndSaveTab({ id: "p", now: 0 }, db);
    const t1 = await togglePin("p", 10, db);
    expect(t1?.pinned).toBe(true);
    expect((await getTab("p", db))?.pinned).toBe(true);
    const t2 = await togglePin("p", 20, db);
    expect(t2?.pinned).toBe(false);
    expect((await getTab("p", db))?.pinned).toBe(false);
  });
});

describe("meta: アクティブタブ id の永続化", () => {
  it("set→get で往復し、null 指定で消える", async () => {
    expect(await getActiveTabId(db)).toBeNull();
    await setActiveTabId("abc", db);
    expect(await getActiveTabId(db)).toBe("abc");
    await setActiveTabId(null, db);
    expect(await getActiveTabId(db)).toBeNull();
  });
});
