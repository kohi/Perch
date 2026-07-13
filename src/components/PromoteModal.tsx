import { useEffect, useState } from "react";
import type { Tab } from "../types/tab";
import { buildPromotion } from "../lib/promote";
import { appendRelatedLinks } from "../lib/noteFile";
import { deriveTitle } from "../lib/title";
import { ruleTags } from "../lib/ruleTags";
import { splitByConfidence, type TagSuggestionInput } from "../lib/aiTags";
import {
  isAiConfigured,
  suggestTags,
  suggestLinks,
  type ClaudeConfig,
  type LinkCandidate,
} from "../lib/claude";
import { isTauri, noteExists, writeNote, readVaultNotes } from "../lib/vaultFs";

/**
 * Vault 昇格ダイアログ（S-05・mozu 方式タグ確定）。screen-spec §6 / requirements §6.5。
 *
 * タグ3系統を統合する:
 *  - ルールベース（本文走査・オフライン即時） → 確定タグ欄（TC-501/502/503）
 *  - AI 自動確定（confidence >= 閾値）        → 確定タグ欄（TC-504）
 *  - AI 提案（confidence < 閾値）             → 提案タグ欄（承認/却下・TC-505/506/507）
 *  - 手動追加                                 → 確定タグ欄（TC-508）
 *
 * YAML `tags:` に出るのは **確定タグのみ**。未承認 suggestedTags は Vault に書き出さない（TC-509）。
 * AI 取得失敗時はルール＋手動だけで昇格可能（TC-511）。アプリは落とさない。
 *
 * 昇格の副作用（inbox/ 書き出し・DB 更新）はここで実行し、成功時 `onPromoted` で更新済み
 * タブ（tags=確定 / suggestedTags=未承認 / promoted / promotedPath）を親へ返す。
 * 決定ロジックは `buildPromotion`・`ruleTags`・`splitByConfidence`（純関数・単体テスト済み）に委譲。
 *
 * 非 Tauri（ブラウザ/E2E）では実 FS 書込みは不可（プレビュー案内）だが、タグ UI
 * （ルール表示・AI 提案・承認/却下/手動追加）は動く（AI は route モックで検証可能）。
 */
export interface PromoteModalProps {
  tab: Tab;
  vaultBase: string | null;
  /** Claude API キー（未設定なら AI タグを無効化しルール＋手動で動作）。 */
  claudeApiKey: string | null;
  /** 使用モデル（resolveModel 済みの値）。lib/claude.ts 経由でのみ使う。 */
  claudeModel: string;
  /** AI 自動確定のしきい値（既定 0.8・meta 由来）。 */
  confidenceThreshold: number;
  /** Vault 未設定時に設定 S-07 を開くよう親へ依頼。 */
  onNeedVault: () => void;
  /** 昇格成功時、更新済みタブ（tags/suggestedTags/promoted/promotedPath 反映）を親へ返す。 */
  onPromoted: (updated: Tab) => void;
  onCancel: () => void;
}

type Phase = "edit" | "confirmOverwrite" | "working";
type AiState = "idle" | "loading" | "done" | "skipped" | "failed";
type LinkState = "idle" | "loading" | "done" | "skipped";

/** 重複を避けて確定タグへ追加（既にあれば何もしない）。挿入順は保持。 */
function addUnique(list: string[], name: string): string[] {
  const n = name.trim();
  if (n.length === 0 || list.includes(n)) return list;
  return [...list, n];
}

/** 空白を畳んで先頭 max 文字に丸めた抜粋（送信・候補生成共通）。全文/パスは送らない。 */
function makeExcerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** frontmatter（先頭 `---` ブロック）を取り除いて本文だけにする。 */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? md.slice(m[0].length) : md;
}

/** ファイル名から `.md` を除いた wiki-link 名。 */
function linkNameOf(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

export function PromoteModal({
  tab,
  vaultBase,
  claudeApiKey,
  claudeModel,
  confidenceThreshold,
  onNeedVault,
  onPromoted,
  onCancel,
}: PromoteModalProps) {
  const initialTitle =
    tab.title.trim().length > 0 ? tab.title : deriveTitle(tab.body, tab.createdAt);
  const [title, setTitle] = useState(initialTitle);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);

  // タグ状態: 確定（ルール＋AI自動確定＋手動＋承認済み）／提案（承認待ち）。
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<TagSuggestionInput[]>([]);
  const [aiState, setAiState] = useState<AiState>("idle");
  const [manualInput, setManualInput] = useState("");

  // [[関連リンク]] 提案（Wave5・Tauri かつ Vault かつ AI 有効時のみ）。タグと同じ承認式。
  const [linkSuggestions, setLinkSuggestions] = useState<Array<{ name: string; score: number }>>(
    [],
  );
  const [approvedLinks, setApprovedLinks] = useState<string[]>([]);
  const [linkState, setLinkState] = useState<LinkState>("idle");

  const tauri = isTauri();
  // 実 Vault 候補が取れる条件（非 Tauri / Vault 未設定はデスクトップ案内のみ）。
  const linksAvailable = tauri && !!vaultBase;

  // ダイアログを開いた時点で: ルールタグを即確定表示 → AI 有効なら通信して振り分け。
  // 再昇格時は既存の tab.tags / tab.suggestedTags も引き継ぐ。
  useEffect(() => {
    let cancelled = false;

    // ルールタグ（オフライン・即時）。既存確定タグとマージ（重複除去）。
    let base: string[] = [];
    for (const t of ruleTags(tab.body, Date.now())) base = addUnique(base, t);
    for (const t of tab.tags) base = addUnique(base, t);
    setConfirmed(base);
    setSuggested(tab.suggestedTags ?? []);

    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!isAiConfigured(claudeApiKey) || !online) {
      setAiState("skipped");
      return;
    }

    setAiState("loading");
    const cfg: ClaudeConfig = { apiKey: claudeApiKey, model: claudeModel };
    void suggestTags(cfg, { title: initialTitle, body: tab.body })
      .then((results) => {
        if (cancelled) return;
        const { confirmed: autoConfirmed, suggested: proposals } = splitByConfidence(
          results,
          confidenceThreshold,
        );
        // 確定欄 = ルール/既存（base）＋ AI 自動確定（重複除去）。
        let finalConfirmed = base;
        for (const name of autoConfirmed) finalConfirmed = addUnique(finalConfirmed, name);
        // 提案欄 = 既存提案 ＋ 新提案のうち「確定にまだ無いもの」（重複除去）。
        const mergedSug: TagSuggestionInput[] = [...(tab.suggestedTags ?? [])];
        for (const p of proposals) {
          if (finalConfirmed.includes(p.name)) continue;
          if (mergedSug.some((s) => s.name === p.name)) continue;
          mergedSug.push(p);
        }
        setConfirmed(finalConfirmed);
        setSuggested(mergedSug);
        setAiState("done");
      })
      .catch(() => {
        // TC-511: AI 失敗はスキップ可。ルール＋手動で昇格継続。アプリは落とさない。
        if (!cancelled) setAiState("failed");
      });

    return () => {
      cancelled = true;
    };
    // マウント時1回のみ（tab は親が key で切替）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // [[関連リンク]] 提案: Tauri かつ Vault かつ AI 有効かつオンラインのとき Vault ノートを
  // 候補化し suggestLinks でランキング取得。id/title/excerpt のみ送信（全文/パスは送らない）。
  useEffect(() => {
    let cancelled = false;
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!linksAvailable || !isAiConfigured(claudeApiKey) || !online) {
      setLinkState("skipped");
      return;
    }

    setLinkState("loading");
    const cfg: ClaudeConfig = { apiKey: claudeApiKey, model: claudeModel };
    // 昇格対象と同名ノートは候補から除外する。
    const selfFilename = buildPromotion({ ...tab, title: initialTitle }, Date.now()).filename;

    void readVaultNotes(vaultBase as string)
      .then((notes) => {
        if (cancelled) return [];
        const candidates: LinkCandidate[] = notes
          .filter((n) => n.filename !== selfFilename)
          .map((n) => ({
            id: linkNameOf(n.filename),
            title: n.filename,
            excerpt: makeExcerpt(stripFrontmatter(n.content)),
          }));
        if (candidates.length === 0) return [];
        return suggestLinks(cfg, {
          source: { title: initialTitle, excerpt: makeExcerpt(tab.body) },
          candidates,
        });
      })
      .then((ranked) => {
        if (cancelled || !Array.isArray(ranked)) return;
        setLinkSuggestions(ranked.map((r) => ({ name: r.id, score: r.score })));
        setLinkState("done");
      })
      .catch(() => {
        // 失敗は昇格導線を止めない（AIタグ失敗と同様スキップ可）。
        if (!cancelled) setLinkState("skipped");
      });

    return () => {
      cancelled = true;
    };
    // マウント時1回のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function approveLink(name: string): void {
    setLinkSuggestions((prev) => prev.filter((s) => s.name !== name));
    setApprovedLinks((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function rejectLink(name: string): void {
    setLinkSuggestions((prev) => prev.filter((s) => s.name !== name));
  }

  function removeApprovedLink(name: string): void {
    setApprovedLinks((prev) => prev.filter((n) => n !== name));
  }

  function removeConfirmed(name: string): void {
    setConfirmed((prev) => prev.filter((t) => t !== name));
  }

  function approveSuggested(name: string): void {
    setSuggested((prev) => prev.filter((s) => s.name !== name));
    setConfirmed((prev) => addUnique(prev, name));
  }

  function rejectSuggested(name: string): void {
    setSuggested((prev) => prev.filter((s) => s.name !== name));
  }

  function addManual(): void {
    const n = manualInput.trim();
    if (n.length === 0) return;
    setConfirmed((prev) => addUnique(prev, n));
    setManualInput("");
  }

  async function runPromote(overwrite: boolean): Promise<void> {
    setError(null);

    // 非 Tauri: 書き込み不可。データは一切触らず案内のみ（タグ UI は使える）。
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
      // 承認済みリンクだけを本文末尾へ追記（未承認は本文に出さない = TC-509 と同思想）。
      // 承認 0 件なら body は不変。
      const bodyWithLinks = appendRelatedLinks(tab.body, approvedLinks);
      // YAML には確定タグのみ（未承認 suggested は渡さない = TC-509）。
      const target: Tab = { ...tab, title, tags: confirmed, body: bodyWithLinks };
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
      // 確定=tags / 未承認=suggestedTags を反映。body は追記後（DB とファイルを一致させる）。
      // DB 反映は親（putTab）が担う。
      onPromoted({
        ...tab,
        title,
        tags: confirmed,
        suggestedTags: suggested,
        body: bodyWithLinks,
        promoted: true,
        promotedPath: path,
      });
    } catch (e) {
      setPhase("edit");
      setError(`昇格に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="modal-overlay" data-testid="promote-modal-overlay" onClick={onCancel}>
      <div
        className="modal modal-promote"
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

        {/* 確定タグ欄（ルール＋AI自動確定＋手動＋承認済み）。×で削除。 */}
        <div className="tag-section">
          <span className="field-label">確定タグ</span>
          <div className="chip-row" data-testid="promote-confirmed-tags">
            {confirmed.length === 0 && (
              <span className="muted chip-empty" data-testid="promote-confirmed-empty">
                （まだありません）
              </span>
            )}
            {confirmed.map((t) => (
              <span key={t} className="chip" data-testid="confirmed-tag" data-tag={t}>
                <span className="chip-label">{t}</span>
                <button
                  className="chip-x"
                  data-testid="confirmed-tag-remove"
                  title="削除"
                  aria-label={`${t} を削除`}
                  onClick={() => removeConfirmed(t)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* 提案タグ欄（confidence < 閾値・承認待ち）。承認→確定へ / 却下→消す。 */}
        <div className="tag-section">
          <span className="field-label">提案タグ（承認待ち）</span>
          {aiState === "loading" && (
            <p className="muted tag-ai-msg" data-testid="promote-ai-loading">
              AI がタグを考えています…
            </p>
          )}
          {aiState === "failed" && (
            <p className="tag-ai-msg tag-ai-failed" data-testid="promote-ai-error">
              AIタグ取得に失敗（スキップ可）。ルール＋手動タグで昇格できます。
            </p>
          )}
          <div className="chip-row" data-testid="promote-suggested-tags">
            {suggested.length === 0 && aiState !== "loading" && (
              <span className="muted chip-empty" data-testid="promote-suggested-empty">
                （なし）
              </span>
            )}
            {suggested.map((s) => (
              <span
                key={s.name}
                className="chip chip-suggested"
                data-testid="suggested-tag"
                data-tag={s.name}
                data-confidence={s.confidence}
              >
                <span className="chip-label">{s.name}</span>
                <button
                  className="chip-approve"
                  data-testid="suggested-approve"
                  title="承認"
                  onClick={() => approveSuggested(s.name)}
                >
                  承認
                </button>
                <button
                  className="chip-reject"
                  data-testid="suggested-reject"
                  title="却下"
                  onClick={() => rejectSuggested(s.name)}
                >
                  却下
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* 手動タグ追加。Enter か［追加］で確定へ。重複は無視。 */}
        <div className="tag-section">
          <span className="field-label">＋タグ追加</span>
          <div className="tag-add-row">
            <input
              className="field-input tag-add-input"
              data-testid="promote-tag-input"
              value={manualInput}
              placeholder="タグ名を入力して Enter"
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              disabled={phase === "working"}
            />
            <button className="btn" data-testid="promote-tag-add" onClick={addManual}>
              追加
            </button>
          </div>
        </div>

        {/* [[関連リンク]] 提案（Wave5 本実装・タグと同じ承認式）。requirements §6.7 / S-05。 */}
        {/* 承認済みリンクのみ本文末尾へ追記される（未承認は Vault に出さない = TC-509 思想）。 */}
        <div className="tag-section">
          <span className="field-label">[[関連リンク]] 提案</span>

          {!linksAvailable && (
            <p className="tag-ai-msg muted" data-testid="promote-links-hint">
              関連リンク提案は Vault を設定したデスクトップアプリでのみ利用できます。
            </p>
          )}
          {linkState === "loading" && (
            <p className="muted tag-ai-msg" data-testid="promote-links-loading">
              AI が関連リンクを探しています…
            </p>
          )}

          {/* 承認済みリンク（本文へ追記される確定分）。×で取り消し。 */}
          <div className="chip-row" data-testid="promote-approved-links">
            {approvedLinks.map((name) => (
              <span key={name} className="chip" data-testid="approved-link" data-link={name}>
                <span className="chip-label">[[{name}]]</span>
                <button
                  className="chip-x"
                  data-testid="approved-link-remove"
                  title="取り消し"
                  aria-label={`${name} を取り消し`}
                  onClick={() => removeApprovedLink(name)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* 提案リンク（承認→承認済みへ / 却下→消す）。 */}
          <div className="chip-row" data-testid="promote-link-suggestions">
            {linkSuggestions.map((s) => (
              <span
                key={s.name}
                className="chip chip-suggested"
                data-testid="link-suggestion"
                data-link={s.name}
                data-score={s.score}
              >
                <span className="chip-label">[[{s.name}]]</span>
                <button
                  className="chip-approve"
                  data-testid="link-approve"
                  title="承認（本文に追記）"
                  onClick={() => approveLink(s.name)}
                >
                  承認
                </button>
                <button
                  className="chip-reject"
                  data-testid="link-reject"
                  title="却下"
                  onClick={() => rejectLink(s.name)}
                >
                  却下
                </button>
              </span>
            ))}
          </div>
        </div>

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
            <button
              className="btn"
              data-testid="promote-overwrite-cancel"
              onClick={() => setPhase("edit")}
            >
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
