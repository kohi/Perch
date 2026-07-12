import { useState } from "react";
import type { Tab } from "../types/tab";
import { buildPromotion } from "../lib/promote";
import { deriveTitle } from "../lib/title";
import { isTauri, noteExists, writeNote } from "../lib/vaultFs";

/**
 * Vault 昇格ダイアログ（S-05）。タイトル編集可・保存先 inbox/ 固定表示。
 *
 * 昇格の副作用（inbox/ 書き出し・DB 更新）はここで実行し、成功時に `onPromoted` で
 * 更新済みタブを親へ返す。決定ロジックは `buildPromotion`（純関数・単体テスト済み）に委譲。
 *
 * ガード:
 * - 非 Tauri（ブラウザ/E2E）: 書き込みはできないため控えめな案内を出し、データは触らない。
 * - Vault 未設定: 設定 S-07 へ誘導し、タブ/データは失わない（TC-407）。
 * - 既存ファイル or 既昇格: 上書き確認を挟む（TC-405）。
 *
 * タグ欄は Wave4-5 管轄のため無効表示のみ（// TODO(Wave4-5)）。
 */
export interface PromoteModalProps {
  tab: Tab;
  vaultBase: string | null;
  /** Vault 未設定時に設定 S-07 を開くよう親へ依頼。 */
  onNeedVault: () => void;
  /** 昇格成功時、更新済みタブ（promoted/promotedPath 反映）を親へ返す。 */
  onPromoted: (updated: Tab) => void;
  onCancel: () => void;
}

type Phase = "edit" | "confirmOverwrite" | "working";

export function PromoteModal({
  tab,
  vaultBase,
  onNeedVault,
  onPromoted,
  onCancel,
}: PromoteModalProps) {
  const initialTitle =
    tab.title.trim().length > 0 ? tab.title : deriveTitle(tab.body, tab.createdAt);
  const [title, setTitle] = useState(initialTitle);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);

  const tauri = isTauri();

  async function runPromote(overwrite: boolean): Promise<void> {
    setError(null);

    // 非 Tauri: 書き込み不可。データは一切触らず案内のみ。
    if (!tauri) {
      setError("Vault への書き出しはデスクトップアプリでのみ利用できます。");
      return;
    }
    // Vault 未設定: 設定へ誘導。タブは保持（TC-407）。
    if (!vaultBase) {
      onNeedVault();
      return;
    }

    setPhase("working");
    try {
      const target: Tab = { ...tab, title };
      const { filename, content } = buildPromotion(target, Date.now());

      // 既昇格 or 既存ファイルなら上書き確認（TC-405）。
      if (!overwrite) {
        const exists = tab.promoted || (await noteExists(vaultBase, "inbox", filename));
        if (exists) {
          setPhase("confirmOverwrite");
          return;
        }
      }

      const path = await writeNote(vaultBase, "inbox", filename, content);
      // 昇格フラグとパスを記録（TC-406）。DB 反映は親（putTab）が担う。
      onPromoted({ ...tab, title, promoted: true, promotedPath: path });
    } catch (e) {
      setPhase("edit");
      setError(`昇格に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="modal-overlay" data-testid="promote-modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        data-testid="promote-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-title-head">Vault に残す</p>

        <label className="field">
          <span className="field-label">タイトル</span>
          <input
            className="field-input"
            data-testid="promote-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={phase === "working"}
          />
        </label>

        <p className="field-static">
          <span className="field-label">保存先</span>
          <span data-testid="promote-dest">inbox/</span>
        </p>

        {/* TODO(Wave4-5): mozu 方式タグ確定 UI（確定タグ/提案タグ/手動追加）。今は無効枠。 */}
        <p className="field-static muted" data-testid="promote-tags-placeholder">
          <span className="field-label">タグ</span>
          <span>（昇格時に付与・Wave4-5 で実装）</span>
        </p>

        {!tauri && (
          <p className="modal-hint" data-testid="promote-hint">
            プレビュー環境です。実際の Vault 書き出しはデスクトップアプリで利用できます。
          </p>
        )}

        {error && (
          <p className="modal-error" data-testid="promote-error">
            {error}
          </p>
        )}

        {phase === "confirmOverwrite" ? (
          <div className="modal-actions" data-testid="promote-overwrite">
            <p className="modal-overwrite-msg">
              同名または昇格済みのノートがあります。上書きしますか？
            </p>
            <button className="btn" data-testid="promote-overwrite-cancel" onClick={() => setPhase("edit")}>
              やめる
            </button>
            <button
              className="btn btn-accent"
              data-testid="promote-overwrite-confirm"
              onClick={() => void runPromote(true)}
            >
              上書きする
            </button>
          </div>
        ) : (
          <div className="modal-actions">
            <button className="btn" data-testid="promote-cancel" onClick={onCancel}>
              キャンセル
            </button>
            <button
              className="btn btn-accent"
              data-testid="promote-confirm"
              disabled={phase === "working"}
              onClick={() => void runPromote(false)}
            >
              {tab.promoted ? "更新する" : "昇格する"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
