import { useState } from "react";
import { ensureVaultDirs, isTauri, pickFolder } from "../lib/vaultFs";
import { setVaultBase } from "../db/meta";
import { MIN_FONT_SIZE, MAX_FONT_SIZE, clampFontSize } from "../lib/fontsize";
import { clampConfidence } from "../db/meta";

/**
 * 設定モーダル（S-07）。Wave 4 で AI 系設定を本実装（無効枠を撤去）。
 *
 * 項目:
 *  - Vault パス（pickFolder → setVaultBase → ensureVaultDirs）。非 Tauri は案内のみ。
 *  - フォントサイズ既定（既存 fontSize と同じ値を編集）。
 *  - confidence 閾値（0〜1・既定 0.8）。AIタグ自動確定のしきい値。
 *  - 使用モデル（既定 claude-sonnet-5）。lib/claude.ts が参照。
 *  - Claude API キー（IndexedDB meta に保存。Git には出ない）。
 *
 * 永続化は親（App）のハンドラが meta に書く（fontSize/vault と同じ単一導線）。
 * ここは値の編集 UI と即時 onChange 通知に徹する（全項目 再起動維持 = TC-704）。
 */
export interface SettingsModalProps {
  vaultBase: string | null;
  fontSizePx: number;
  confidenceThreshold: number;
  claudeModel: string;
  claudeApiKey: string | null;
  /** Vault パス変更を親へ通知（App の state 更新用）。 */
  onVaultChange: (base: string) => void;
  onFontSizeChange: (px: number) => void;
  onConfidenceChange: (v: number) => void;
  onModelChange: (v: string) => void;
  onApiKeyChange: (v: string | null) => void;
  onClose: () => void;
}

export function SettingsModal({
  vaultBase,
  fontSizePx,
  confidenceThreshold,
  claudeModel,
  claudeApiKey,
  onVaultChange,
  onFontSizeChange,
  onConfidenceChange,
  onModelChange,
  onApiKeyChange,
  onClose,
}: SettingsModalProps) {
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

        <div className="field">
          <span className="field-label">フォントサイズ既定（px）</span>
          <input
            className="field-input"
            data-testid="settings-fontsize"
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={fontSizePx}
            onChange={(e) => onFontSizeChange(clampFontSize(Number(e.target.value)))}
          />
        </div>

        <div className="field">
          <span className="field-label">confidence 閾値（0〜1・AIタグ自動確定）</span>
          <input
            className="field-input"
            data-testid="settings-confidence"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={confidenceThreshold}
            onChange={(e) => onConfidenceChange(clampConfidence(Number(e.target.value)))}
          />
          <p className="field-desc muted">
            この値以上のAI提案タグは自動確定、未満は提案止まり（手動承認待ち）。
          </p>
        </div>

        <div className="field">
          <span className="field-label">使用モデル（Claude）</span>
          <input
            className="field-input"
            data-testid="settings-model"
            type="text"
            value={claudeModel}
            placeholder="claude-sonnet-5"
            onChange={(e) => onModelChange(e.target.value)}
          />
          <p className="field-desc muted">
            あのあれ検索・AIタグが使うモデル名。<code>lib/claude.ts</code> が参照する。
          </p>
        </div>

        <div className="field">
          <span className="field-label">Claude API キー</span>
          <input
            className="field-input"
            data-testid="settings-apikey"
            type="password"
            autoComplete="off"
            value={claudeApiKey ?? ""}
            placeholder="未設定（AI 機能は無効）"
            onChange={(e) => onApiKeyChange(e.target.value.length > 0 ? e.target.value : null)}
          />
          <p className="field-desc muted">
            あのあれ検索・AIタグ用。ローカル（IndexedDB）に保存し、Git には出ません。
          </p>
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
