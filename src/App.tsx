import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Tab } from "./types/tab";
import { deriveTitle } from "./lib/title";
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
} from "./db/meta";
import { stepFontSize } from "./lib/fontsize";
import { CodeMirrorEditor, type CodeMirrorHandle } from "./editor/CodeMirrorEditor";
import { DiscardModal } from "./components/DiscardModal";
import { ContextMenu } from "./components/ContextMenu";

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

  const editorRef = useRef<CodeMirrorHandle>(null);
  const pendingFocusRef = useRef(false);

  // 起動時: IndexedDB から全タブ・最後のアクティブタブ・フォントサイズ・ペイン幅を復元。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [restored, savedActive, savedFont, savedPane] = await Promise.all([
        listTabs(),
        getActiveTabId(),
        getFontSize(),
        getPaneWidth(),
      ]);
      if (cancelled) return;
      setTabs(restored);
      const activeExists = savedActive && restored.some((t) => t.id === savedActive);
      setActiveId(activeExists ? savedActive : (restored[0]?.id ?? null));
      setFontSizePx(savedFont);
      setPaneWidthState(savedPane);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => sortTabs(tabs), [tabs]);
  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    void setActiveTabId(id);
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
        void putTab(next);
        return prev.map((t) => (t.id === next.id ? next : t));
      });
    },
    [activeId],
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
    // TODO(Wave3): _drafts/ の対応ファイルも削除する。
    await dbDeleteTab(id);
    setDiscardTargetId(null);
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

  // --- フォントサイズ（A-/A+・Cmd±）。変更値は meta 永続化 → 再起動維持（TC-306/307）。 ---
  const changeFontSize = useCallback((dir: 1 | -1) => {
    setFontSizePx((cur) => {
      const next = stepFontSize(cur, dir);
      void setFontSize(next);
      return next;
    });
  }, []);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, changeFontSize]);

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
        <div className="sidebar-scroll" data-testid="tablist-scroll">
          {ordered.length === 0 && (
            <p className="empty-hint">タブがありません。［＋新規］で作成。</p>
          )}
          {ordered.map((t) => (
            <div
              key={t.id}
              className={"tab-item" + (t.id === activeId ? " active" : "")}
              data-testid="tab-item"
              data-tabid={t.id}
              data-active={t.id === activeId ? "true" : "false"}
              onClick={() => selectTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="tab-pin" title={t.pinned ? "ピン留め中" : "ピン留め"}>
                {t.pinned ? "📌" : "・"}
              </span>
              <span className="tab-title" data-testid="tab-title">
                {t.title || deriveTitle(t.body, t.createdAt)}
              </span>
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
            {/* TODO(Wave3): Vault昇格(S-05)。今は無効プレースホルダ。 */}
            <button
              className="tool-btn"
              data-testid="promote-btn"
              disabled
              title="Wave 3で実装"
            >
              ［これ残す］
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label:
                (tabs.find((t) => t.id === contextMenu.tabId)?.pinned ? "ピン留め解除" : "ピン留め"),
              testId: "ctx-pin",
              onSelect: () => void handleTogglePin(contextMenu.tabId),
            },
            {
              label: "破棄",
              testId: "ctx-delete",
              danger: true,
              onSelect: () => requestDelete(contextMenu.tabId),
            },
          ]}
        />
      )}

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
    </div>
  );
}
