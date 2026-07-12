import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getActiveTabId, setActiveTabId } from "./db/meta";

/**
 * Perch メインウィンドウ（S-01）。Wave 1 スコープ:
 * タブ CRUD ＋ 1文字ごとの自動保存 ＋ 再起動での全タブ復元。
 *
 * 編集面は Wave 1 では textarea。
 * TODO(Wave2): CodeMirror 6 に差し替え（フォントサイズ・HTML/JS/CSS ハイライト・行番号）。
 */
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 起動時: IndexedDB から全タブと最後のアクティブタブを復元（TC-102）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [restored, savedActive] = await Promise.all([listTabs(), getActiveTabId()]);
      if (cancelled) return;
      setTabs(restored);
      const activeExists = savedActive && restored.some((t) => t.id === savedActive);
      setActiveId(activeExists ? savedActive : (restored[0]?.id ?? null));
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
  }, []);

  // 本文変更: 1文字ごとに full put で即保存（損失は最大1put ＝ debounce なし）。
  const handleBodyChange = useCallback(
    (body: string) => {
      if (!active) return;
      const next: Tab = {
        ...active,
        body,
        title: deriveTitle(body, active.createdAt),
        updatedAt: Date.now(),
      };
      setTabs((prev) => prev.map((t) => (t.id === next.id ? next : t)));
      void putTab(next);
    },
    [active],
  );

  const handleTogglePin = useCallback(async (id: string) => {
    const updated = await dbTogglePin(id, Date.now());
    if (updated) setTabs((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      // TODO(Wave3): 未昇格タブは S-06 破棄確認モーダルを経由する。
      await dbDeleteTab(id);
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== id);
        if (activeId === id) {
          const nextActive = sortTabs(remaining)[0]?.id ?? null;
          setActiveId(nextActive);
          void setActiveTabId(nextActive);
        }
        return remaining;
      });
    },
    [activeId],
  );

  // 復元完了までは何も描かない（フラッシュ防止）。DB名は harness が参照する固定値。
  const dbName = db.name;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!loaded) {
    return <div className="loading" data-testid="loading" data-dbname={dbName} />;
  }

  return (
    <div className="app" data-testid="app" data-dbname={dbName} data-tabcount={tabs.length}>
      <aside className="sidebar" data-testid="tablist">
        <div className="sidebar-scroll">
          {ordered.length === 0 && (
            <p className="empty-hint">タブがありません。［＋新規］で作成。</p>
          )}
          {ordered.map((t) => (
            <div
              key={t.id}
              className={"tab-item" + (t.id === activeId ? " active" : "")}
              data-testid="tab-item"
              data-tabid={t.id}
              onClick={() => selectTab(t.id)}
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
                    void handleDelete(t.id);
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

      <main className="editor">
        {active ? (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            data-testid="editor"
            value={active.body}
            placeholder="ここに入力（1文字ごとに自動保存）"
            onChange={(e) => handleBodyChange(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="editor-empty">タブを選択、または［＋新規］で作成してください。</div>
        )}
      </main>
    </div>
  );
}
