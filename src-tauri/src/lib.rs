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

/// base/inbox 直下の `*.md` を全て読んで返す（あのあれ検索の Vault 側候補）。
/// inbox が無ければ空 Vec。ロジックは vault.rs の純関数に委譲。
#[tauri::command]
fn read_vault_notes(base: String) -> Result<Vec<vault::VaultNote>, String> {
    vault::read_vault_notes_impl(&base)
}

/// base/inbox/filename を OS 既定アプリ（.md 関連付け＝Obsidian 等）で開く。
/// resolve_safe_path で検証してからのみ `open` に渡す（想定外パスは開かない）。
#[tauri::command]
fn open_note(base: String, filename: String) -> Result<(), String> {
    vault::open_note_impl(&base, &filename)
}

/// フォルダ選択ダイアログを表示し、選択された絶対パスを返す（キャンセルは None）。
///
/// 【重要・フリーズ対策】このコマンドは **async** にする。Tauri 2 では同期コマンドは
/// メインスレッドで実行されるため、そこで `blocking_pick_folder()` を呼ぶと
/// ダイアログのイベントループを回すメインスレッドが塞がり、アプリ全体がフリーズする。
/// async コマンドはメインスレッド外（async runtime）で走るので、非ブロッキングの
/// コールバック版 `pick_folder` でダイアログをメインスレッドへ委譲し、結果を
/// チャネルで受け取る。こうするとメインスレッドは解放され、ダイアログが操作可能になる。
/// （フロントから直接 dialog プラグインは呼ばず、この command 経由に限定する。）
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    // 非ブロッキング。ダイアログはメインスレッドのイベントループで表示され、
    // 選択/キャンセル時にこのコールバックがメインスレッドから呼ばれる。
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    // async runtime 上で待機（メインスレッドは塞がない）。コールバックが send するまで待つ。
    let picked = rx
        .recv()
        .map_err(|e| format!("フォルダ選択の受信に失敗: {e}"))?;
    match picked {
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
            read_vault_notes,
            open_note,
            pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
