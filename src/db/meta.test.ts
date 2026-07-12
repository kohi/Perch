import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerchDB } from "./db";
import {
  getVaultBase,
  setVaultBase,
  getActiveTabId,
  setActiveTabId,
  getFontSize,
  setFontSize,
} from "./meta";

/**
 * meta（UI 状態）永続化の実検証。fake-indexeddb で実際に書いて読み戻す（偽装なし）。
 * vaultBase 追加が既存 key（activeTabId / fontSize）を壊さないことも確認する。
 */

let db: PerchDB;
let counter = 0;

beforeEach(() => {
  db = new PerchDB(`perch-meta-test-${counter++}`);
});

afterEach(async () => {
  await db.delete();
});

describe("vaultBase の永続化", () => {
  it("初期状態は null", async () => {
    expect(await getVaultBase(db)).toBeNull();
  });

  it("set→get で往復し、実 DB に残る", async () => {
    await setVaultBase("/Users/me/Vault", db);
    expect(await getVaultBase(db)).toBe("/Users/me/Vault");
    // meta ストアを直接読んでも副作用が確認できる
    const entry = await db.meta.get("vaultBase");
    expect(entry?.value).toBe("/Users/me/Vault");
  });

  it("null 指定で削除される", async () => {
    await setVaultBase("/x", db);
    expect(await getVaultBase(db)).toBe("/x");
    await setVaultBase(null, db);
    expect(await getVaultBase(db)).toBeNull();
    expect(await db.meta.get("vaultBase")).toBeUndefined();
  });

  it("vaultBase 追加が activeTabId / fontSize と共存する（キー衝突なし）", async () => {
    await setActiveTabId("tab-9", db);
    await setFontSize(18, db);
    await setVaultBase("/vault", db);
    expect(await getActiveTabId(db)).toBe("tab-9");
    expect(await getFontSize(db)).toBe(18);
    expect(await getVaultBase(db)).toBe("/vault");
  });
});
