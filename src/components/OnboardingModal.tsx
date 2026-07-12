import { useState } from "react";
import { ensureVaultDirs, isTauri, pickFolder } from "../lib/vaultFs";
import { setVaultBase } from "../db/meta";

/**
 * 初回起動オンボーディング（S-08）。目的は Vault フォルダの選択（必須）。
 * API キーは枠のみ・スキップ可（後 Wave）。非 Tauri では表示しない（App 側でガード）。
 *
 * Vault 選択: pickFolder → setVaultBase → ensureVaultDirs → onDone(base)。
 */
export interface OnboardingModalProps {
  onDone: (base: string) => void;
}

export function OnboardingModal({ onDone }: OnboardingModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectVault(): Promise<void> {
    if (!isTauri()) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await pickFolder();
      if (!picked) {
        setError("Vault フォルダの選択が必要です。");
        return;
      }
      await setVaultBase(picked);
      await ensureVaultDirs(picked);
      onDone(picked);
    } catch (e) {
      setError(`設定に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" data-testid="onboarding-modal-overlay">
      <div className="modal" data-testid="onboarding-modal" role="dialog" aria-modal="true">
        <p className="modal-title-head">Perch へようこそ</p>
        <p className="modal-message">
          メモを揮発させないため、保存先の Vault フォルダを選んでください。
          選んだフォルダ配下に <code>_drafts/</code>（自動バックアップ）と{" "}
          <code>inbox/</code>（昇格先）を作成します。
        </p>

        {error && (
          <p className="modal-error" data-testid="onboarding-error">
            {error}
          </p>
        )}

        {/* API キーは枠のみ・後から設定可能（スキップ可）。 */}
        <p className="field-desc muted" data-testid="onboarding-apikey-placeholder">
          Claude API キー（あのあれ検索・AI タグ用）は後から設定できます。
        </p>

        <div className="modal-actions">
          <button
            className="btn btn-accent"
            data-testid="onboarding-pick"
            onClick={() => void selectVault()}
            disabled={busy}
          >
            Vault フォルダを選択
          </button>
        </div>
      </div>
    </div>
  );
}
