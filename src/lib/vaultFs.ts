/**
 * Tauri FS コマンドの薄い型付きラッパ＋環境判定。
 *
 * 【最重要】非 Tauri（ブラウザ / Playwright の Chromium）では `invoke` が存在しない。
 * 呼び出し側は必ず `isTauri()` でガードし、非 Tauri では draft 書き出し・昇格・
 * オンボーディングを no-op/スキップすること。これにより Wave1/2 の E2E（Tauri 無し）が
 * 不変で緑を保つ。import 自体は安全（関数を呼ばなければ副作用なし）。
 *
 * Rust 側（src-tauri）が filename の `/ \ .. 空`・絶対パス・不正 kind を拒否する。
 * slug は必ず `slugify` を通し、区切り・`..` を含めないこと。
 */

import { invoke } from "@tauri-apps/api/core";

/** Vault 内の書き出し種別。draft=_drafts（副保存）, inbox=昇格先。 */
export type NoteKind = "draft" | "inbox";

/** 現在の実行環境が Tauri（デスクトップアプリ）かどうか。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * `.md` を書き出し、書いた絶対パスを返す。
 * @param base Vault のベースフォルダ（ユーザー選択）
 * @param kind "draft" → _drafts, "inbox" → inbox
 * @param filename slugify 済みの安全ファイル名（`/ \ ..` を含めない）
 */
export function writeNote(
  base: string,
  kind: NoteKind,
  filename: string,
  content: string,
): Promise<string> {
  return invoke<string>("write_note", { base, kind, filename, content });
}

/** `.md` を削除する（冪等：無くてもエラーにならない）。 */
export function deleteNote(base: string, kind: NoteKind, filename: string): Promise<void> {
  return invoke<void>("delete_note", { base, kind, filename });
}

/** 指定 `.md` が存在するか。 */
export function noteExists(base: string, kind: NoteKind, filename: string): Promise<boolean> {
  return invoke<boolean>("note_exists", { base, kind, filename });
}

/** Vault 直下に `_drafts/` `inbox/` を用意する（冪等）。 */
export function ensureVaultDirs(base: string): Promise<void> {
  return invoke<void>("ensure_vault_dirs", { base });
}

/** フォルダ選択ダイアログを開く。キャンセル時は null。 */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>("pick_folder");
}

/** Vault 内の1ノート（inbox/*.md）。あのあれ検索の候補・Obsidian で開く用。 */
export interface VaultNote {
  /** ファイル名（`YYYY-MM-DD-slug.md`）。 */
  filename: string;
  /** 絶対パス。結果の所在提示・open_note の識別に使う。 */
  path: string;
  /** ファイル本文（frontmatter 含む）。検索の抜粋生成に使う。 */
  content: string;
}

/**
 * inbox/ 配下の `.md` を全件読む。あのあれ検索の候補源（Tauri のみ）。
 * 非 Tauri では呼び出し側が isTauri() でガードすること（invoke が無い）。
 */
export function readVaultNotes(base: string): Promise<VaultNote[]> {
  return invoke<VaultNote[]>("read_vault_notes", { base });
}

/** inbox/ の指定 `.md` を OS 既定アプリ（Obsidian 等）で開く。非 Tauri は呼ばない。 */
export function openNote(base: string, filename: string): Promise<void> {
  return invoke<void>("open_note", { base, filename });
}
