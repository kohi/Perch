import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Tab } from "./types/tab";
import { createTab } from "./types/tab";
import { deriveTitle } from "./lib/title";
import { filterTabsByTitle } from "./lib/tabFilter";
import { db } from "./db/db";
import {
  createAndSaveTab,
  deleteTab as dbDeleteTab,
  listTabs,
  putTab,
  sortTabs,
  togglePin as dbTogglePin,
} from "./db/tabs";
import {
  getActiveTabId,
  setActiveTabId,
  getFontSize,
  setFontSize,
  getPaneWidth,
  setPaneWidth,
  clampPaneWidth,
  getVaultBase,
  getConfidenceThreshold,
  setConfidenceThreshold,
  getClaudeModel,
  setClaudeModel,
  getClaudeApiKey,
  setClaudeApiKey,
  DEFAULT_CONFIDENCE,
} from "./db/meta";
import { stepFontSize } from "./lib/fontsize";
import { DEFAULT_MODEL, resolveModel } from "./lib/claude";
import { isTauri, writeNote, deleteNote, openNote } from "./lib/vaultFs";
import { draftFilename, buildNoteMarkdown } from "./lib/noteFile";
import { CodeMirrorEditor, type CodeMirrorHandle } from "./editor/CodeMirrorEditor";
import { DiscardModal } from "./components/DiscardModal";
import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
import { PromoteModal } from "./components/PromoteModal";
import { SettingsModal } from "./components/SettingsModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { SearchBar, type SearchBarHandle } from "./components/SearchBar";

/** _drafts/ への二重保存 debounce（秒）。IndexedDB 主保存はこれとは独立に即時実行する。 */
const DRAFT_DEBOUNCE_MS = 2000;

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

/**
 * Perch メインウィンドウ（S-01）。Wave 2 スコープ:
 * CodeMirror 6 エディタ（フォントサイズ・HTML/JS/CSS ハイライト・行番号）、
 * タブ一覧強化（右クリックメニュー・破棄確認モーダル S-06）、
 * レイアウト永続化（ペイン幅・フォントサイズ・最後のアクティブタブ）。
 */
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fontSizePx, setFontSizePx] = useState(14);
  const [paneWidth, setPaneWidthState] = useState(280);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [discardTargetId, setDiscardTargetId] = useState<string | null>(null);
  const [vaultBase, setVaultBaseState] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [promoteTargetId, setPromoteTargetId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState(false);
  // 増幅対象の複数選択（S-04 機能2）。破棄時に除去する。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // タブ絞込フィルタ（S-02・表示のみ・active/選択/DB に影響させない）。
  const [filterQuery, setFilterQuery] = useState("");
  // AI 設定（S-07）。永続化は meta、変更は SettingsModal 経由。
  const [confidenceThreshold, setConfidenceThresholdState] = useState(DEFAULT_CONFIDENCE);
  const [claudeModel, setClaudeModelState] = useState(DEFAULT_MODEL);
  const [claudeApiKey, setClaudeApiKeyState] = useState<string | null>(null);

  const editorRef = useRef<CodeMirrorHandle>(null);
  const searchRef = useRef<SearchBarHandle>(null);
  const pendingFocusRef = useRef(false);
  // 最新の vaultBase を debounce 発火時に参照するための ref（クロージャ陳腐化を防ぐ）。
  const vaultBaseRef = useRef<string | null>(null);
  // タブごとの draft 書き出し debounce タイマー。
  const draftTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 起動時: IndexedDB から全タブ・最後のアクティブタブ・フォントサイズ・ペイン幅を復元。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [restored, savedActive, savedFont, savedPane, savedVault, savedConf, savedModel, savedKey] =
        await Promise.all([
          listTabs(),
          getActiveTabId(),
          getFontSize(),
          getPaneWidth(),
          getVaultBase(),
          getConfidenceThreshold(),
          getClaudeModel(),
          getClaudeApiKey(),
        ]);
      if (cancelled) return;
      setTabs(restored);
      const activeExists = savedActive && restored.some((t) => t.id === savedActive);
      setActiveId(activeExists ? savedActive : (restored[0]?.id ?? null));
      setFontSizePx(savedFont);
      setPaneWidthState(savedPane);
      setVaultBaseState(savedVault);
      vaultBaseRef.current = savedVault;
      setConfidenceThresholdState(savedConf);
      setClaudeModelState(savedModel);
      setClaudeApiKeyState(savedKey);
      // 初回（Tauri かつ Vault 未設定）のみオンボーディング。非 Tauri では出さない（E2E 不変）。
      if (isTauri() && savedVault === null) setShowOnboarding(true);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // vaultBase の最新値を ref に同期（debounce 発火時に参照）。
  useEffect(() => {
    vaultBaseRef.current = vaultBase;
  }, [vaultBase]);

  // アンマウント時に保留中の draft タイマーを掃除（テスト/HMR でのリーク防止）。
  useEffect(() => {
    const timers = draftTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  /**
   * _drafts/ への二重保存を debounce でスケジュールする（screen-spec §4.2）。
   * IndexedDB 主保存（putTab）は呼び出し側で即時に済んでいる前提。ここは「副」保存。
   * 非 Tauri or Vault 未設定では no-op（ブラウザ E2E に影響させない）。
   * 失敗しても入力は止めず、控えめな警告フラグのみ立てる（§4.3）。
   */
  const scheduleDraftWrite = useCallback((tab: Tab) => {
    if (!isTauri()) return;
    const timers = draftTimersRef.current;
    const existing = timers.get(tab.id);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      timers.delete(tab.id);
      const base = vaultBaseRef.current;
      if (!base) return; // Vault 未設定なら副保存はスキップ（主保存は継続済み）
      const content = buildNoteMarkdown({
        title: tab.title,
        body: tab.body,
        createdAt: tab.createdAt,
        tags: tab.tags,
      });
      void writeNote(base, "draft", draftFilename(tab.id), content)
        .then(() => setDraftError(false))
        .catch(() => setDraftError(true)); // 入力は止めない・警告のみ
    }, DRAFT_DEBOUNCE_MS);
    timers.set(tab.id, handle);
  }, []);

  const ordered = useMemo(() => sortTabs(tabs), [tabs]);
  // 表示リストはフィルタ後（絞込は表示のみ）。空クエリなら ordered と同一。
  const filtered = useMemo(() => filterTabsByTitle(ordered, filterQuery), [ordered, filterQuery]);
  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);
  // 増幅へ渡す選択 id（存在するタブのみ・順序は一覧順）。
  const selectedTabIds = useMemo(
    () => ordered.filter((t) => selectedIds.has(t.id)).map((t) => t.id),
    [ordered, selectedIds],
  );

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    void setActiveTabId(id);
  }, []);

  /** 増幅対象のチェック選択トグル（S-04 機能2）。 */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * 増幅完了: 生成本文で新規タブを作り IndexedDB へ保存し、アクティブにする（S-04 機能2）。
   * 既存タブは一切変更しない。生成タブは通常タブ（以後 1文字ごと自動保存の対象）。
   */
  const handleAmplified = useCallback((body: string) => {
    const tab = createTab({ id: crypto.randomUUID(), now: Date.now(), body });
    void putTab(tab);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    void setActiveTabId(tab.id);
  }, []);

  const handleNewTab = useCallback(async () => {
    const tab = await createAndSaveTab({ id: crypto.randomUUID(), now: Date.now() });
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    void setActiveTabId(tab.id);
    pendingFocusRef.current = true; // 描画後にエディタへフォーカス（TC-201）
  }, []);

  // active が変わった直後、新規作成起因ならエディタにフォーカスする。
  useEffect(() => {
    if (pendingFocusRef.current && active) {
      pendingFocusRef.current = false;
      // マウント完了を待ってからフォーカス
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [active]);

  // 本文変更: 1文字ごとに full put で即保存（損失は最大1put ＝ debounce なし）。
  const handleBodyChange = useCallback(
    (body: string) => {
      setTabs((prev) => {
        const cur = prev.find((t) => t.id === activeId);
        if (!cur) return prev;
        const next: Tab = {
          ...cur,
          body,
          title: deriveTitle(body, cur.createdAt),
          updatedAt: Date.now(),
        };
        // 主 = IndexedDB へ即時保存（揮発防止の要・遅延させない）。
        void putTab(next);
        // 副 = _drafts/ へ debounce 書き出し（二重保存・Tauri のみ）。
        scheduleDraftWrite(next);
        return prev.map((t) => (t.id === next.id ? next : t));
      });
    },
    [activeId, scheduleDraftWrite],
  );

  const handleTogglePin = useCallback(async (id: string) => {
    const updated = await dbTogglePin(id, Date.now());
    if (updated) setTabs((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }, []);

  // 破棄要求 → S-06 確認モーダルを開く（実削除は confirm 時）。
  const requestDelete = useCallback((id: string) => {
    setDiscardTargetId(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    const id = discardTargetId;
    if (!id) return;
    // 保留中の draft タイマーがあれば止める（削除後に書き戻さないため）。
    const pending = draftTimersRef.current.get(id);
    if (pending) {
      clearTimeout(pending);
      draftTimersRef.current.delete(id);
    }
    // 主 = IndexedDB から削除。
    await dbDeleteTab(id);
    // 副 = _drafts/ の対応ファイルも削除（TC-106 完成形）。Tauri かつ Vault 設定時のみ。
    const base = vaultBaseRef.current;
    if (isTauri() && base) {
      void deleteNote(base, "draft", draftFilename(id)).catch(() => {
        /* 冪等・削除失敗は致命ではない。DB からは既に消えている。 */
      });
    }
    setDiscardTargetId(null);
    // 破棄されたタブは増幅選択からも除去する。
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const nextActive = sortTabs(remaining)[0]?.id ?? null;
        setActiveId(nextActive);
        void setActiveTabId(nextActive);
      }
      return remaining;
    });
  }, [discardTargetId, activeId]);

  // --- Vault 昇格（S-05）／設定（S-07）／オンボーディング（S-08）。 ---

  /** Vault パス確定（設定・オンボーディング共通）。state と ref を同期。 */
  const handleVaultChange = useCallback((base: string) => {
    setVaultBaseState(base);
    vaultBaseRef.current = base;
    setDraftError(false); // パスが有効になったので警告解除
  }, []);

  /** フォントサイズを明示値で設定（S-07 の数値入力）。meta 永続化 → 再起動維持（TC-704）。 */
  const handleFontSizeExact = useCallback((px: number) => {
    setFontSizePx(px);
    void setFontSize(px);
  }, []);

  /** confidence 閾値変更（S-07）。meta 永続化 → 昇格時の AI 自動確定に反映（TC-510/704）。 */
  const handleConfidenceChange = useCallback((v: number) => {
    setConfidenceThresholdState(v);
    void setConfidenceThreshold(v);
  }, []);

  /** 使用モデル変更（S-07）。meta 永続化 → lib/claude.ts 呼び出しへ反映（TC-705）。 */
  const handleModelChange = useCallback((v: string) => {
    setClaudeModelState(v);
    void setClaudeModel(v);
  }, []);

  /** API キー変更（S-07）。IndexedDB meta に保存（Git に出ない）。TC-704。 */
  const handleApiKeyChange = useCallback((v: string | null) => {
    setClaudeApiKeyState(v);
    void setClaudeApiKey(v);
  }, []);

  /** 昇格成功時：更新済みタブを DB 永続化＋一覧へ反映（TC-406）。 */
  const handlePromoted = useCallback((updated: Tab) => {
    void putTab(updated);
    setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setPromoteTargetId(null);
  }, []);

  const promoteTarget = useMemo(
    () => tabs.find((t) => t.id === promoteTargetId) ?? null,
    [tabs, promoteTargetId],
  );

  // --- フォントサイズ（A-/A+・Cmd±）。変更値は meta 永続化 → 再起動維持（TC-306/307）。 ---
  const changeFontSize = useCallback((dir: 1 | -1) => {
    setFontSizePx((cur) => {
      const next = stepFontSize(cur, dir);
      void setFontSize(next);
      return next;
    });
  }, []);

  // --- キーボードショートカット（screen-spec §10.1）。全て preventDefault する。 ---
  useEffect(() => {
    if (!loaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        changeFontSize(1);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        changeFontSize(-1);
      } else if (e.key === "n" || e.key === "N") {
        // Cmd+N: 新規タブ（作成後エディタへフォーカス）。
        e.preventDefault();
        void handleNewTab();
      } else if (e.key === "s" || e.key === "S") {
        // Cmd+S: アクティブタブの S-05 昇格ダイアログ（本文が空なら無効）。
        e.preventDefault();
        if (active && active.body.trim().length > 0) setPromoteTargetId(active.id);
      } else if (e.key === "f" || e.key === "F") {
        // Cmd+F: あのあれ検索入力へフォーカス。
        e.preventDefault();
        searchRef.current?.focusInput();
      } else if (e.key === ",") {
        // Cmd+,: 設定（S-07）。
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, changeFontSize, handleNewTab, active]);

  // --- ペイン幅リサイズ（ドラッグ）。確定(mouseup)で meta 永続化（screen-spec §10.2）。 ---
  const draggingRef = useRef(false);
  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setPaneWidthState(clampPaneWidth(ev.clientX));
    };
    const onUp = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const finalWidth = clampPaneWidth(ev.clientX);
      setPaneWidthState(finalWidth);
      void setPaneWidth(finalWidth);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // 復元完了までは何も描かない（フラッシュ防止）。DB名は harness が参照する固定値。
  const dbName = db.name;

  if (!loaded) {
    return <div className="loading" data-testid="loading" data-dbname={dbName} />;
  }

  return (
    <div
      className="app"
      data-testid="app"
      data-dbname={dbName}
      data-tabcount={tabs.length}
      style={{ gridTemplateColumns: `${paneWidth}px 5px 1fr` }}
    >
      <aside className="sidebar" data-testid="tablist">
        {/* タブ絞込（S-02・タイトル部分一致・表示のみ）。オフライン・非 AI で動く。 */}
        <div className="tab-filter-row">
          <span className="search-icon" aria-hidden>
            🔍
          </span>
          <input
            className="tab-filter-input"
            data-testid="tab-filter"
            type="search"
            placeholder="タブ絞込"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>
        <div className="sidebar-scroll" data-testid="tablist-scroll">
          {ordered.length === 0 && (
            <p className="empty-hint">タブがありません。［＋新規］で作成。</p>
          )}
          {ordered.length > 0 && filtered.length === 0 && filterQuery.trim().length > 0 && (
            <p className="empty-hint" data-testid="tab-filter-empty">
              「{filterQuery}」に一致するタブはありません。
            </p>
          )}
          {filtered.map((t) => (
            <div
              key={t.id}
              className={"tab-item" + (t.id === activeId ? " active" : "")}
              data-testid="tab-item"
              data-tabid={t.id}
              data-active={t.id === activeId ? "true" : "false"}
              data-promoted={t.promoted ? "true" : "false"}
              onClick={() => selectTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
              }}
            >
              <input
                type="checkbox"
                className="tab-select"
                data-testid="tab-select"
                data-tabid={t.id}
                checked={selectedIds.has(t.id)}
                title="増幅対象に選択"
                aria-label="増幅対象に選択"
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(t.id)}
              />
              <span className="tab-pin" title={t.pinned ? "ピン留め中" : "ピン留め"}>
                {t.pinned ? "📌" : "・"}
              </span>
              <span className="tab-title" data-testid="tab-title">
                {t.title || deriveTitle(t.body, t.createdAt)}
              </span>
              {t.promoted && (
                <span
                  className="tab-promoted"
                  data-testid="tab-promoted-mark"
                  title="Vault 昇格済み"
                  aria-label="昇格済み"
                >
                  ✓
                </span>
              )}
              <span className="tab-actions">
                <button
                  className="icon-btn"
                  title="ピン留めトグル"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleTogglePin(t.id);
                  }}
                >
                  📍
                </button>
                <button
                  className="icon-btn danger"
                  title="破棄"
                  data-testid="tab-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDelete(t.id);
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
        <button className="new-tab-btn" data-testid="new-tab" onClick={() => void handleNewTab()}>
          ＋ 新規
        </button>
      </aside>

      <div
        className="resizer"
        data-testid="resizer"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startResize}
      />

      <main className="editor">
        <div className="toolbar" data-testid="toolbar">
          <div className="toolbar-group">
            <button
              className="tool-btn"
              data-testid="font-dec"
              title="フォント縮小（Cmd -）"
              onClick={() => changeFontSize(-1)}
            >
              A-
            </button>
            <button
              className="tool-btn"
              data-testid="font-inc"
              title="フォント拡大（Cmd +）"
              onClick={() => changeFontSize(1)}
            >
              A+
            </button>
          </div>
          <div className="toolbar-group">
            {/* #タグ表示（S-03 §4.1）。昇格前はミュート表示（Wave3 で確定タグを反映）。 */}
            <span className="tag-display muted" data-testid="tag-display" title="確定タグ">
              #（昇格時に付与）
            </span>
          </div>
          <div className="toolbar-group toolbar-right">
            {/* _drafts/ 書き出し失敗時の控えめ警告（§4.3）。クリックで設定へ誘導。 */}
            {draftError && (
              <button
                className="tool-btn warn"
                data-testid="draft-warning"
                title="バックアップ書き出しに失敗しました。設定で Vault を確認してください。"
                onClick={() => setShowSettings(true)}
              >
                ⚠ バックアップ失敗
              </button>
            )}
            <button
              className="tool-btn"
              data-testid="settings-open"
              title="設定（S-07）"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
            {/* Vault 昇格（S-05）。アクティブタブが空でなければ有効。 */}
            <button
              className="tool-btn"
              data-testid="promote-btn"
              disabled={!active || active.body.trim().length === 0}
              title="Vault に残す（S-05）"
              onClick={() => active && setPromoteTargetId(active.id)}
            >
              {active?.promoted ? "［更新］" : "［これ残す］"}
            </button>
          </div>
        </div>

        <div className="editor-body">
          {active ? (
            <CodeMirrorEditor
              ref={editorRef}
              key={active.id}
              value={active.body}
              onChange={handleBodyChange}
              fontSizePx={fontSizePx}
              testId="editor"
            />
          ) : (
            <div className="editor-empty">タブを選択、または［＋新規］で作成してください。</div>
          )}
        </div>
      </main>

      <SearchBar
        ref={searchRef}
        tabs={tabs}
        vaultBase={vaultBase}
        claudeModel={resolveModel(claudeModel)}
        claudeApiKey={claudeApiKey}
        activeTabId={activeId}
        selectedTabIds={selectedTabIds}
        onSelectTab={selectTab}
        onOpenSettings={() => setShowSettings(true)}
        onAmplified={handleAmplified}
      />

      {contextMenu &&
        (() => {
          const ctxTab = tabs.find((t) => t.id === contextMenu.tabId) ?? null;
          const items: ContextMenuItem[] = [
            {
              label: ctxTab?.pinned ? "ピン留め解除" : "ピン留め",
              testId: "ctx-pin",
              onSelect: () => void handleTogglePin(contextMenu.tabId),
            },
          ];
          // 昇格済み かつ Tauri かつ Vault 設定時のみ「Vault で開く」（screen-spec §3.2）。
          if (ctxTab?.promoted && ctxTab.promotedPath && isTauri() && vaultBase) {
            const filename = ctxTab.promotedPath.split("/").pop() ?? "";
            items.push({
              label: "Vault で開く",
              testId: "ctx-open-vault",
              onSelect: () =>
                void openNote(vaultBase, filename).catch(() => {
                  /* 開けなくてもタブは失わない。 */
                }),
            });
          }
          items.push({
            label: "破棄",
            testId: "ctx-delete",
            danger: true,
            onSelect: () => requestDelete(contextMenu.tabId),
          });
          return (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              items={items}
            />
          );
        })()}

      {discardTargetId && (
        <DiscardModal
          title={
            tabs.find((t) => t.id === discardTargetId)
              ? deriveTitle(
                  tabs.find((t) => t.id === discardTargetId)!.body,
                  tabs.find((t) => t.id === discardTargetId)!.createdAt,
                )
              : ""
          }
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDiscardTargetId(null)}
        />
      )}

      {promoteTarget && (
        <PromoteModal
          tab={promoteTarget}
          vaultBase={vaultBase}
          claudeApiKey={claudeApiKey}
          claudeModel={resolveModel(claudeModel)}
          confidenceThreshold={confidenceThreshold}
          onNeedVault={() => {
            setPromoteTargetId(null);
            setShowSettings(true);
          }}
          onPromoted={handlePromoted}
          onCancel={() => setPromoteTargetId(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          vaultBase={vaultBase}
          fontSizePx={fontSizePx}
          confidenceThreshold={confidenceThreshold}
          claudeModel={claudeModel}
          claudeApiKey={claudeApiKey}
          onVaultChange={handleVaultChange}
          onFontSizeChange={handleFontSizeExact}
          onConfidenceChange={handleConfidenceChange}
          onModelChange={handleModelChange}
          onApiKeyChange={handleApiKeyChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          onDone={(base) => {
            handleVaultChange(base);
            setShowOnboarding(false);
          }}
        />
      )}
    </div>
  );
}
