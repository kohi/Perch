import { useCallback, useState } from "react";
import type { Tab } from "../types/tab";
import { deriveTitle } from "../lib/title";
import { isAiConfigured, rankNotes, type RankCandidate } from "../lib/claude";
import { isTauri, readVaultNotes, openNote } from "../lib/vaultFs";

/**
 * あのあれ検索バー（S-04）。requirements §6.6 / TC-601〜607。
 *
 * フワッとした自然文クエリを Claude（lib/claude.ts 経由）に投げ、意味的に近いメモを
 * 順位付けして返す。候補 = 全タブ ＋ Vault ノート（inbox/*.md, Tauri かつ base 設定時）。
 * 結果クリックでタブを開く / Vault ノートを Obsidian で開く。
 *
 * 【重要】Claude API を叩くコードは lib/claude.ts に集約。ここは claude.ts 経由でのみ呼ぶ
 * （モデル名/エンドポイント直書き禁止）。送信は id/title/抜粋のみ（全文/パスは送らない = TC-607）。
 */

type SearchStatus = "idle" | "loading" | "done" | "offline" | "no-key" | "error";

/** 表示用の検索結果。所在（タブ / Vault）で分岐する。 */
interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  location: "tab" | "vault";
  /** location==="vault" のときのファイル名（open_note 用）。 */
  filename?: string;
  /** location==="vault" のときの絶対パス（所在提示用）。 */
  path?: string;
}

export interface SearchBarProps {
  tabs: Tab[];
  vaultBase: string | null;
  claudeModel: string;
  claudeApiKey: string | null;
  /** タブ結果クリック → App がそのタブを開く。 */
  onSelectTab: (id: string) => void;
  /** APIキー未設定時の「設定へ」導線。 */
  onOpenSettings: () => void;
}

/** 空白を畳んで先頭 max 文字に丸めた抜粋を作る（送信・表示共通）。 */
function makeExcerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** frontmatter（先頭 `---` ブロック）を取り除いて本文だけにする。 */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? md.slice(m[0].length) : md;
}

export function SearchBar({
  tabs,
  vaultBase,
  claudeModel,
  claudeApiKey,
  onSelectTab,
  onOpenSettings,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length === 0) return;

    // APIキー未設定 → 検索無効・設定誘導（TC-606）。アプリは落とさない。
    if (!isAiConfigured(claudeApiKey)) {
      setResults([]);
      setStatus("no-key");
      return;
    }
    // オフライン → 検索不可（他機能は継続）（TC-605）。
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setResults([]);
      setStatus("offline");
      return;
    }

    setStatus("loading");
    setResults([]);
    setErrorMsg("");

    // 候補を組む。タブ本文＋（Tauri かつ base 設定時）Vault inbox/*.md。
    // 抜粋のみ保持し、全文/パスは rankNotes へ渡さない（送信範囲最小化 = TC-607）。
    const candidates: RankCandidate[] = [];
    const meta = new Map<string, SearchResult>();

    for (const t of tabs) {
      const title = t.title.trim().length > 0 ? t.title : deriveTitle(t.body, t.createdAt);
      const excerpt = makeExcerpt(t.body);
      candidates.push({ id: t.id, title, excerpt });
      meta.set(t.id, { id: t.id, title, excerpt, score: 0, location: "tab" });
    }

    if (isTauri() && vaultBase) {
      try {
        const notes = await readVaultNotes(vaultBase);
        for (const n of notes) {
          const title = n.filename;
          const excerpt = makeExcerpt(stripFrontmatter(n.content));
          // id はパス（Vault 内で一意）。
          candidates.push({ id: n.path, title, excerpt });
          meta.set(n.path, {
            id: n.path,
            title,
            excerpt,
            score: 0,
            location: "vault",
            filename: n.filename,
            path: n.path,
          });
        }
      } catch {
        // Vault 読み取り失敗はタブ候補のみで続行（検索自体は落とさない）。
      }
    }

    if (candidates.length === 0) {
      setResults([]);
      setStatus("done");
      return;
    }

    try {
      const ranked = await rankNotes(
        { apiKey: claudeApiKey, model: claudeModel },
        { query: q, candidates },
      );
      const mapped: SearchResult[] = [];
      for (const r of ranked) {
        const base = meta.get(r.id);
        if (base) mapped.push({ ...base, score: r.score });
      }
      mapped.sort((a, b) => b.score - a.score);
      setResults(mapped);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setResults([]);
      setStatus("error");
    }
  }, [query, tabs, vaultBase, claudeModel, claudeApiKey]);

  const handleResultClick = useCallback(
    (r: SearchResult) => {
      if (r.location === "tab") {
        onSelectTab(r.id);
      } else if (r.location === "vault" && vaultBase && r.filename && isTauri()) {
        void openNote(vaultBase, r.filename).catch(() => {
          /* 開けなくても検索結果は残す。パスは表示済み。 */
        });
      }
    },
    [onSelectTab, vaultBase],
  );

  return (
    <section className="searchbar" data-testid="searchbar" aria-label="あのあれ検索">
      <div className="search-row">
        <span className="search-icon" aria-hidden>
          🔍
        </span>
        <input
          className="search-input"
          data-testid="search-input"
          type="search"
          placeholder="あのあれ検索：「税金の話どっかでしたよね」…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
        />
        <button
          className="btn search-run"
          data-testid="search-run"
          onClick={() => void runSearch()}
          disabled={status === "loading"}
        >
          検索
        </button>

        {/* 拡張スロット（差し込み口）。requirements §6.7。初期は無効プレースホルダ。 */}
        {/* TODO(拡張): 関連メモをあぶり出す（RAG / 近傍探索へ進化） */}
        <button
          className="btn search-ext"
          data-testid="search-ext-surface"
          disabled
          title="今後のバージョンで対応（拡張スロット）"
        >
          関連メモをあぶり出す
        </button>
        {/* TODO(拡張): 選択した複数タブをまとめて増幅する */}
        <button
          className="btn search-ext"
          data-testid="search-ext-amplify"
          disabled
          title="今後のバージョンで対応（拡張スロット）"
        >
          選択タブを増幅
        </button>
      </div>

      <div className="search-results" data-testid="search-results">
        {status === "loading" && (
          <p className="search-msg muted" data-testid="search-loading">
            検索中…
          </p>
        )}
        {status === "no-key" && (
          <p className="search-msg" data-testid="search-nokey">
            あのあれ検索には Claude API キーが必要です。
            <button
              className="link-btn"
              data-testid="search-open-settings"
              onClick={onOpenSettings}
            >
              設定でキーを入力
            </button>
          </p>
        )}
        {status === "offline" && (
          <p className="search-msg" data-testid="search-offline">
            ネット接続が必要です（他の機能はそのまま使えます）。
          </p>
        )}
        {status === "error" && (
          <p className="search-msg" data-testid="search-error">
            検索に失敗しました：{errorMsg}
          </p>
        )}
        {status === "done" && results.length === 0 && (
          <p className="search-msg muted" data-testid="search-empty">
            近いメモが見つからなかった。
          </p>
        )}
        {status === "done" &&
          results.map((r) => (
            <button
              key={r.id}
              className="search-result"
              data-testid="search-result"
              data-location={r.location}
              data-id={r.id}
              onClick={() => handleResultClick(r)}
            >
              <span className="search-result-head">
                <span className="search-result-title">{r.title}</span>
                <span
                  className={"search-result-loc " + (r.location === "tab" ? "loc-tab" : "loc-vault")}
                >
                  {r.location === "tab" ? "タブ" : "Vault"}
                </span>
              </span>
              <span className="search-result-excerpt muted">{r.excerpt}</span>
              {r.location === "vault" && r.path && (
                <span className="search-result-path muted" data-testid="search-result-path">
                  {r.path}
                </span>
              )}
            </button>
          ))}
      </div>
    </section>
  );
}
