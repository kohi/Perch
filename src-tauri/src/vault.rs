//! Vault への FS 書き出しロジック本体（Wave 3）。
//!
//! CLAUDE.md 方針:
//! - Rust は薄く（OS 機能のみ）。`#[tauri::command]` ラッパは lib.rs 側に置き、
//!   ここには純粋なロジックだけを置いてテスト容易にする。
//! - **セキュリティ核心**: Vault への書き込みはユーザー選択フォルダ配下
//!   （`inbox/` `_drafts/`）に限定。想定外パスへの書き込みは禁止。
//!   その検証をテスト可能な純関数 `resolve_safe_path` に集約し、
//!   write/delete/exists は必ずこの関数を通してからアクセスする。

use std::path::{Component, Path, PathBuf};

/// `kind`（invoke 契約の論理名）を実サブフォルダ名へマップする。
/// `"draft"` → `_drafts`、`"inbox"` → `inbox`。それ以外は Err。
pub fn subdir_for(kind: &str) -> Result<&'static str, String> {
    match kind {
        "draft" => Ok("_drafts"),
        "inbox" => Ok("inbox"),
        other => Err(format!("不正な kind です: {other}（draft|inbox のみ許可）")),
    }
}

/// パスを **ファイルシステムに触れず** 字句的に正規化する。
/// `.` を除去し `..` で 1 つ上る。シンボリックリンクは解決しない（存在前提を持たない）。
/// 多層防御の「収まっているか」判定に使う。
fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 書き込み/削除/存在確認の対象パスを安全に解決する。**セキュリティ境界**。
///
/// - `base` は絶対パスであること。
/// - `kind` は `draft`/`inbox` のみ。
/// - `filename` は空不可・`/`・`\`・`..` を含まない・絶対パスでないこと。
/// - `target = base/subdir/filename`。加えて多層防御として、字句正規化後の
///   `target` が `base/subdir` 配下に収まることを確認する（外に出るなら Err）。
pub fn resolve_safe_path(base: &str, kind: &str, filename: &str) -> Result<PathBuf, String> {
    let base_path = Path::new(base);
    if !base_path.is_absolute() {
        return Err(format!("base は絶対パスである必要があります: {base}"));
    }

    let subdir = subdir_for(kind)?;

    if filename.is_empty() {
        return Err("filename が空です".to_string());
    }
    // `/` を弾くことで先頭 `/`（絶対パス）と `a/b.md`（サブパス）を同時に拒否する。
    if filename.contains('/') || filename.contains('\\') {
        return Err(format!(
            "filename にパス区切り文字を含めることはできません: {filename}"
        ));
    }
    if filename.contains("..") {
        return Err(format!("filename に `..` を含めることはできません: {filename}"));
    }

    let dir = base_path.join(subdir);
    let target = dir.join(filename);

    // 多層防御: 字句正規化後も base/subdir 配下に収まることを確認する。
    let normalized_dir = lexical_normalize(&dir);
    let normalized_target = lexical_normalize(&target);
    if !normalized_target.starts_with(&normalized_dir) {
        return Err(format!(
            "解決後のパスが許可ディレクトリの外に出ます: {}",
            normalized_target.display()
        ));
    }
    // ディレクトリ自身（filename が実質空/カレントに解決）を書き込み対象にしない。
    if normalized_target == normalized_dir {
        return Err(format!("filename がファイルを指していません: {filename}"));
    }

    Ok(normalized_target)
}

/// content(UTF-8) を base/subdir/filename に書き、書いた絶対パス（文字列）を返す。
/// 必要なら base/subdir を作成する。
pub fn write_note_impl(
    base: &str,
    kind: &str,
    filename: &str,
    content: &str,
) -> Result<String, String> {
    let path = resolve_safe_path(base, kind, filename)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("ディレクトリ作成に失敗: {e}"))?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("書き込みに失敗: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// base/subdir/filename を削除する。存在しなくても Ok（冪等）。
pub fn delete_note_impl(base: &str, kind: &str, filename: &str) -> Result<(), String> {
    let path = resolve_safe_path(base, kind, filename)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("削除に失敗: {e}")),
    }
}

/// base/subdir/filename が存在するか。
pub fn note_exists_impl(base: &str, kind: &str, filename: &str) -> Result<bool, String> {
    let path = resolve_safe_path(base, kind, filename)?;
    Ok(path.is_file())
}

/// base/inbox と base/_drafts を作成する。
pub fn ensure_vault_dirs_impl(base: &str) -> Result<(), String> {
    let base_path = Path::new(base);
    if !base_path.is_absolute() {
        return Err(format!("base は絶対パスである必要があります: {base}"));
    }
    for sub in ["inbox", "_drafts"] {
        std::fs::create_dir_all(base_path.join(sub))
            .map_err(|e| format!("{sub} の作成に失敗: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 偽装テスト禁止（CLAUDE.md）。真偽値固定や DB 完結ではなく、
    //! **実際に一時ディレクトリへ書いて実ファイル/実バイトを検証**する。
    //! 注: `pick_folder` は UI ダイアログのため自動テスト対象外。
    use super::*;

    /// 一意な一時 base ディレクトリを作る。呼び出し側が drop で後始末する。
    fn temp_base() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("perch-vault-test-")
            .tempdir()
            .expect("一時ディレクトリ作成")
    }

    #[test]
    fn draft_write_creates_real_file_with_exact_bytes() {
        let dir = temp_base();
        let base = dir.path().to_str().unwrap();
        let content = "# 揮発しないメモ\nあのあれ\u{1F426}"; // 非 ASCII/絵文字含む

        let written = write_note_impl(base, "draft", "note-1.md", content).unwrap();

        // 返り値パスに実ファイルが実在する。
        let p = Path::new(&written);
        assert!(p.is_file(), "返り値パスにファイルが実在しない: {written}");
        // 期待どおり base/_drafts 配下。
        assert_eq!(p.parent().unwrap(), dir.path().join("_drafts"));
        // 中身がバイト一致する。
        let read = std::fs::read(&written).unwrap();
        assert_eq!(read, content.as_bytes(), "書いた content とバイト不一致");
    }

    #[test]
    fn inbox_write_creates_subdir_and_file() {
        let dir = temp_base();
        let base = dir.path().to_str().unwrap();
        // サブフォルダは事前に無い。
        assert!(!dir.path().join("inbox").exists());

        let content = "promoted note body";
        let written = write_note_impl(base, "inbox", "kept.md", content).unwrap();

        assert!(dir.path().join("inbox").is_dir(), "inbox が自動作成されていない");
        assert_eq!(std::fs::read(&written).unwrap(), content.as_bytes());
    }

    #[test]
    fn exists_reflects_create_and_delete_and_delete_is_idempotent() {
        let dir = temp_base();
        let base = dir.path().to_str().unwrap();

        // 作成前は false。
        assert!(!note_exists_impl(base, "draft", "x.md").unwrap());

        write_note_impl(base, "draft", "x.md", "hello").unwrap();
        // 作成後は true。
        assert!(note_exists_impl(base, "draft", "x.md").unwrap());

        let target = dir.path().join("_drafts").join("x.md");
        assert!(target.is_file());

        delete_note_impl(base, "draft", "x.md").unwrap();
        // 削除後は実在しない。
        assert!(!target.exists(), "削除後もファイルが残っている");
        assert!(!note_exists_impl(base, "draft", "x.md").unwrap());

        // 存在しない削除も Ok（冪等）。
        delete_note_impl(base, "draft", "x.md").unwrap();
    }

    #[test]
    fn ensure_vault_dirs_creates_both() {
        let dir = temp_base();
        let base = dir.path().to_str().unwrap();
        ensure_vault_dirs_impl(base).unwrap();
        assert!(dir.path().join("inbox").is_dir());
        assert!(dir.path().join("_drafts").is_dir());
    }

    #[test]
    fn rejects_path_traversal_and_writes_nothing_outside_base() {
        let dir = temp_base();
        let base = dir.path().to_str().unwrap();

        let bad_names = [
            "../evil.md",     // 親へ脱出
            "..",             // 親そのもの
            "a/b.md",         // サブパス
            "/etc/evil.md",   // 絶対パス
            "sub\\evil.md",   // Windows 風区切り
            "",               // 空
        ];
        for name in bad_names {
            let err = write_note_impl(base, "draft", name, "x");
            assert!(err.is_err(), "危険な filename が拒否されていない: {name:?}");
        }

        // 不正 kind も拒否。
        assert!(write_note_impl(base, "bogus", "ok.md", "x").is_err());

        // base が相対パスでも拒否。
        assert!(write_note_impl("relative/dir", "draft", "ok.md", "x").is_err());

        // resolve_safe_path 直接でも同様に Err。
        assert!(resolve_safe_path(base, "draft", "../evil.md").is_err());
        assert!(resolve_safe_path(base, "inbox", "a/b.md").is_err());

        // 実害確認: base 配下・親ディレクトリを走査し evil.md 等が漏れていないこと。
        let mut leaked = Vec::new();
        collect_files(dir.path(), &mut leaked);
        if let Some(parent) = dir.path().parent() {
            // 親直下のみ浅く確認（temp_dir 全走査は避ける）。
            if let Ok(rd) = std::fs::read_dir(parent) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_file() {
                        leaked.push(p);
                    }
                }
            }
        }
        for p in &leaked {
            let name = p.file_name().unwrap().to_string_lossy();
            assert_ne!(name, "evil.md", "base 外/内に evil.md が作られた: {}", p.display());
        }
        // トラバーサル拒否後、base 直下に想定外ファイルが無いこと（_drafts/inbox 以外は空）。
    }

    fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    collect_files(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
    }

    #[test]
    fn subdir_mapping_is_exact() {
        assert_eq!(subdir_for("draft").unwrap(), "_drafts");
        assert_eq!(subdir_for("inbox").unwrap(), "inbox");
        assert!(subdir_for("drafts").is_err());
        assert!(subdir_for("Draft").is_err());
    }
}
