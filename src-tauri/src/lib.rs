//! Perch のバックエンド（Rust / Tauri 2）。
//! CLAUDE.md 方針: Rust は薄く使う（OS 機能のみ）。ロジックの大半は JS/TS 側。
//!
//! Wave 3: Vault 二重保存（`_drafts/` 自動書き出し・`inbox/` 昇格）の FS コマンド。
//! 書き込みはユーザー選択フォルダ配下（`inbox/` `_drafts/`）に限定する。
//! FS ロジック本体は `vault.rs` の純関数に置き、ここのコマンドは薄く呼ぶだけ。

mod vault;

/// content(UTF-8) を base/{_drafts|inbox}/filename に書き、書いた絶対パスを返す。
#[tauri::command]
fn write_note(
    base: String,
    kind: String,
    filename: String,
    content: String,
) -> Result<String, String> {
    vault::write_note_impl(&base, &kind, &filename, &content)
}

/// base/{_drafts|inbox}/filename を削除する（存在しなくても Ok）。
#[tauri::command]
fn delete_note(base: String, kind: String, filename: String) -> Result<(), String> {
    vault::delete_note_impl(&base, &kind, &filename)
}

/// base/{_drafts|inbox}/filename が存在するか。
#[tauri::command]
fn note_exists(base: String, kind: String, filename: String) -> Result<bool, String> {
    vault::note_exists_impl(&base, &kind, &filename)
}

/// base/inbox と base/_drafts を作成する。
#[tauri::command]
fn ensure_vault_dirs(base: String) -> Result<(), String> {
    vault::ensure_vault_dirs_impl(&base)
}

/// フォルダ選択ダイアログを表示し、選択された絶対パスを返す（キャンセルは None）。
/// tauri-plugin-dialog の Rust ブロッキング API を使う（フロントから直接 dialog は呼ばない）。
#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    match app.dialog().file().blocking_pick_folder() {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| format!("パス解決に失敗: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_note,
            delete_note,
            note_exists,
            ensure_vault_dirs,
            pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
