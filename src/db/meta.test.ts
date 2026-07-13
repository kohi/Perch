import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerchDB } from "./db";
import {
  getVaultBase,
  setVaultBase,
  getActiveTabId,
  setActiveTabId,
  getFontSize,
  setFontSize,
  getConfidenceThreshold,
  setConfidenceThreshold,
  DEFAULT_CONFIDENCE,
  getClaudeModel,
  setClaudeModel,
  getClaudeApiKey,
  setClaudeApiKey,
} from "./meta";
import { DEFAULT_MODEL } from "../lib/claude";

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

describe("confidence 閾値の永続化（TC-704）", () => {
  it("初期は既定 0.8", async () => {
    expect(await getConfidenceThreshold(db)).toBe(DEFAULT_CONFIDENCE);
    expect(DEFAULT_CONFIDENCE).toBe(0.8);
  });

  it("set→get で往復し、実 DB に残る", async () => {
    await setConfidenceThreshold(0.5, db);
    expect(await getConfidenceThreshold(db)).toBe(0.5);
    expect((await db.meta.get("confidenceThreshold"))?.value).toBe("0.5");
  });

  it("範囲外は [0,1] に clamp される", async () => {
    await setConfidenceThreshold(1.7, db);
    expect(await getConfidenceThreshold(db)).toBe(1);
    await setConfidenceThreshold(-0.3, db);
    expect(await getConfidenceThreshold(db)).toBe(0);
  });
});

describe("Claude モデル名の永続化（TC-705）", () => {
  it("初期は既定 DEFAULT_MODEL", async () => {
    expect(await getClaudeModel(db)).toBe(DEFAULT_MODEL);
  });

  it("set→get で変更が反映される", async () => {
    await setClaudeModel("claude-opus-9", db);
    expect(await getClaudeModel(db)).toBe("claude-opus-9");
    expect((await db.meta.get("claudeModel"))?.value).toBe("claude-opus-9");
  });

  it("空文字は削除扱い（既定に戻る）", async () => {
    await setClaudeModel("claude-x", db);
    await setClaudeModel("   ", db);
    expect(await getClaudeModel(db)).toBe(DEFAULT_MODEL);
    expect(await db.meta.get("claudeModel")).toBeUndefined();
  });
});

describe("Claude API キーの永続化", () => {
  it("初期は null", async () => {
    expect(await getClaudeApiKey(db)).toBeNull();
  });

  it("set→get で往復し、実 DB(meta) に保存される", async () => {
    await setClaudeApiKey("sk-ant-123", db);
    expect(await getClaudeApiKey(db)).toBe("sk-ant-123");
    expect((await db.meta.get("claudeApiKey"))?.value).toBe("sk-ant-123");
  });

  it("null / 空白は削除扱い", async () => {
    await setClaudeApiKey("sk-x", db);
    await setClaudeApiKey(null, db);
    expect(await getClaudeApiKey(db)).toBeNull();
    await setClaudeApiKey("sk-y", db);
    await setClaudeApiKey("   ", db);
    expect(await getClaudeApiKey(db)).toBeNull();
  });

  it("3 設定が既存キー（activeTabId / fontSize / vaultBase）と共存する", async () => {
    await setActiveTabId("tab-1", db);
    await setFontSize(16, db);
    await setVaultBase("/v", db);
    await setConfidenceThreshold(0.6, db);
    await setClaudeModel("claude-z", db);
    await setClaudeApiKey("sk-z", db);
    expect(await getActiveTabId(db)).toBe("tab-1");
    expect(await getFontSize(db)).toBe(16);
    expect(await getVaultBase(db)).toBe("/v");
    expect(await getConfidenceThreshold(db)).toBe(0.6);
    expect(await getClaudeModel(db)).toBe("claude-z");
    expect(await getClaudeApiKey(db)).toBe("sk-z");
  });
});
