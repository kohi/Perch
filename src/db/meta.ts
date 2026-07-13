import type { PerchDB } from "./db";
import { db as defaultDb } from "./db";
import { clampFontSize, DEFAULT_FONT_SIZE } from "../lib/fontsize";
import { DEFAULT_MODEL } from "../lib/claude";

/** UI 状態（最後のアクティブタブ・ペイン幅・フォントサイズ等）の永続化。screen-spec §10.2。 */

const ACTIVE_TAB_KEY = "activeTabId";
const FONT_SIZE_KEY = "fontSize";
const PANE_WIDTH_KEY = "paneWidth";
const VAULT_BASE_KEY = "vaultBase";
const CONFIDENCE_KEY = "confidenceThreshold";
const CLAUDE_MODEL_KEY = "claudeModel";
const CLAUDE_API_KEY = "claudeApiKey";

/** AIタグ自動確定のしきい値の既定（screen-spec S-07 / requirements §6.5）。 */
export const DEFAULT_CONFIDENCE = 0.8;

/** confidence 閾値を [0,1] に丸める。NaN は既定にフォールバック。 */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONFIDENCE;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** ペイン幅の許容範囲（screen-spec §2 分割比・ドラッグリサイズ）。 */
export const PANE_WIDTH_MIN = 180;
export const PANE_WIDTH_MAX = 600;
export const DEFAULT_PANE_WIDTH = 280;

export function clampPaneWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PANE_WIDTH;
  if (n < PANE_WIDTH_MIN) return PANE_WIDTH_MIN;
  if (n > PANE_WIDTH_MAX) return PANE_WIDTH_MAX;
  return n;
}

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

/** フォントサイズ（px）を永続化。値は clamp してから保存する。 */
export async function setFontSize(px: number, db: PerchDB = defaultDb): Promise<void> {
  await db.meta.put({ key: FONT_SIZE_KEY, value: String(clampFontSize(px)) });
}

/** 保存済みフォントサイズ（無ければ既定）。数値は文字列で保存されているため parse する。 */
export async function getFontSize(db: PerchDB = defaultDb): Promise<number> {
  const entry = await db.meta.get(FONT_SIZE_KEY);
  if (!entry) return DEFAULT_FONT_SIZE;
  return clampFontSize(Number(entry.value));
}

/** サイドバー幅（px）を永続化。値は clamp してから保存する。 */
export async function setPaneWidth(px: number, db: PerchDB = defaultDb): Promise<void> {
  await db.meta.put({ key: PANE_WIDTH_KEY, value: String(clampPaneWidth(px)) });
}

/** 保存済みサイドバー幅（無ければ既定）。 */
export async function getPaneWidth(db: PerchDB = defaultDb): Promise<number> {
  const entry = await db.meta.get(PANE_WIDTH_KEY);
  if (!entry) return DEFAULT_PANE_WIDTH;
  return clampPaneWidth(Number(entry.value));
}

/**
 * Vault ベースフォルダ（昇格先 inbox/・副保存 _drafts/ の親）。screen-spec §8/§10.2。
 * 未設定なら null。設定は S-07 / オンボーディング S-08 経由でのみ行う。
 */
export async function setVaultBase(path: string | null, db: PerchDB = defaultDb): Promise<void> {
  if (path === null) {
    await db.meta.delete(VAULT_BASE_KEY);
  } else {
    await db.meta.put({ key: VAULT_BASE_KEY, value: path });
  }
}

export async function getVaultBase(db: PerchDB = defaultDb): Promise<string | null> {
  const entry = await db.meta.get(VAULT_BASE_KEY);
  return entry?.value ?? null;
}

/**
 * AIタグ自動確定の confidence 閾値（0〜1・既定 0.8）。S-07 で変更可能・再起動維持（TC-704）。
 * 保存時に [0,1] へ clamp する。
 */
export async function setConfidenceThreshold(v: number, db: PerchDB = defaultDb): Promise<void> {
  await db.meta.put({ key: CONFIDENCE_KEY, value: String(clampConfidence(v)) });
}

export async function getConfidenceThreshold(db: PerchDB = defaultDb): Promise<number> {
  const entry = await db.meta.get(CONFIDENCE_KEY);
  if (!entry) return DEFAULT_CONFIDENCE;
  return clampConfidence(Number(entry.value));
}

/**
 * Claude 使用モデル名（既定 DEFAULT_MODEL）。S-07 で変更 → lib/claude.ts 呼び出しへ反映（TC-705）。
 * 空文字は削除扱い（＝既定にフォールバック）。
 */
export async function setClaudeModel(model: string, db: PerchDB = defaultDb): Promise<void> {
  const s = model.trim();
  if (s.length === 0) {
    await db.meta.delete(CLAUDE_MODEL_KEY);
    return;
  }
  await db.meta.put({ key: CLAUDE_MODEL_KEY, value: s });
}

export async function getClaudeModel(db: PerchDB = defaultDb): Promise<string> {
  const entry = await db.meta.get(CLAUDE_MODEL_KEY);
  const v = entry?.value?.trim();
  return v && v.length > 0 ? v : DEFAULT_MODEL;
}

/**
 * Claude API キー（既定 null）。IndexedDB(meta) に保存 = Git には出ない。
 * 空/空白は削除扱い（未設定 = AI 機能無効）。
 */
export async function setClaudeApiKey(key: string | null, db: PerchDB = defaultDb): Promise<void> {
  if (key === null || key.trim().length === 0) {
    await db.meta.delete(CLAUDE_API_KEY);
    return;
  }
  await db.meta.put({ key: CLAUDE_API_KEY, value: key });
}

export async function getClaudeApiKey(db: PerchDB = defaultDb): Promise<string | null> {
  const entry = await db.meta.get(CLAUDE_API_KEY);
  return entry?.value ?? null;
}
