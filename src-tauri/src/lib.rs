//! Perch のバックエンド（Rust / Tauri 2）。
//! CLAUDE.md 方針: Rust は薄く使う（OS 機能のみ）。ロジックの大半は JS/TS 側。
//!
//! Wave 1 スコープではフロント(IndexedDB)が主保存先。ここは雛形のみ。
//! TODO(Wave3): Vault 二重保存（`_drafts/` 自動書き出し・`inbox/` 昇格）の
//!              FS コマンドを追加する。書き込みはユーザー選択フォルダ配下に限定。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
