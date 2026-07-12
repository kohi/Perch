/**
 * タブ破棄確認モーダル（S-06）。
 * 未昇格タブの破棄時に表示する。Wave2 は IndexedDB からの削除まで。
 * TODO(Wave3): 破棄実行時に `_drafts/` の対応ファイルも削除する。
 */
export interface DiscardModalProps {
  /** 破棄対象タブのタイトル（確認文言に添える） */
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiscardModal({ title, onConfirm, onCancel }: DiscardModalProps) {
  return (
    <div
      className="modal-overlay"
      data-testid="discard-modal-overlay"
      onClick={onCancel}
    >
      <div
        className="modal"
        data-testid="discard-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="modal-message">このメモを破棄します。元に戻せません。</p>
        {title && <p className="modal-target">「{title}」</p>}
        <div className="modal-actions">
          <button className="btn" data-testid="discard-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="btn btn-danger"
            data-testid="discard-confirm"
            onClick={onConfirm}
          >
            破棄
          </button>
        </div>
      </div>
    </div>
  );
}
