import { useState } from "react";
import { ensureVaultDirs, isTauri, pickFolder } from "../lib/vaultFs";
import { setVaultBase } from "../db/meta";

/**
 * 設定モーダル（S-07）。Wave 3 スコープ：Vault パス項目のみ実装。
 * その他（フォントサイズ既定・confidence 閾値・使用モデル・APIキー）は後 Wave の無効枠。
 *
 * Vault 変更: pickFolder → setVaultBase（meta 永続化）→ ensureVaultDirs（_drafts/ inbox/ 作成）。
 * 非 Tauri ではフォルダ選択不可のため案内のみ（E2E に影響させない）。
 */
export interface SettingsModalProps {
  vaultBase: string | null;
  /** Vault パス変更を親へ通知（App の state 更新用）。 */
  onVaultChange: (base: string) => void;
  onClose: () => void;
}

export function SettingsModal({ vaultBase, onVaultChange, onClose }: SettingsModalProps) {
  const [busy, setBusy] = useState(false);
  const tauri = isTauri();

  async function changeVault(): Promise<void> {
    if (!tauri) return;
    setBusy(true);
    try {
      const picked = await pickFolder();
      if (picked) {
        await setVaultBase(picked);
        await ensureVaultDirs(picked);
        onVaultChange(picked);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" data-testid="settings-modal-overlay" onClick={onClose}>
      <div
        className="modal"
        data-testid="settings-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-title-head">設定</p>

        <div className="field">
          <span className="field-label">Vault フォルダ</span>
          <p className="field-value" data-testid="settings-vault-path">
            {vaultBase ?? "未設定"}
          </p>
          <p className="field-desc muted">
            昇格先 <code>inbox/</code> とバックアップ <code>_drafts/</code> の親フォルダ。
          </p>
          <button
            className="btn"
            data-testid="settings-change-vault"
            onClick={() => void changeVault()}
            disabled={!tauri || busy}
            title={tauri ? "フォルダを選択" : "デスクトップアプリでのみ変更できます"}
          >
            {vaultBase ? "変更" : "選択"}
          </button>
          {!tauri && (
            <p className="modal-hint" data-testid="settings-hint">
              フォルダ選択はデスクトップアプリで利用できます。
            </p>
          )}
        </div>

        {/* 後 Wave の設定項目（無効枠）。 */}
        <div className="field muted" data-testid="settings-placeholder">
          {/* TODO(Wave5): フォントサイズ既定・confidence 閾値・使用モデル・APIキー */}
          <span className="field-label">その他の設定</span>
          <p className="field-desc">フォントサイズ既定・confidence 閾値・使用モデル・API キー（今後のバージョンで対応）。</p>
        </div>

        <div className="modal-actions">
          <button className="btn" data-testid="settings-close" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
