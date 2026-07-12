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
