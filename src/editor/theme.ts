import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * 墨と和紙ダーク基調のエディタテーマ（S-03 / デザイントークン §10.3）。
 * 色は全て `var(--...)` 経由。直値ハードコードはしない。
 */
export const perchEditorTheme: Extension = EditorView.theme(
  {
    "&": {
      color: "var(--fg)",
      backgroundColor: "var(--bg)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      lineHeight: "1.6",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "12px 0",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--accent-weak)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--panel)",
      color: "var(--muted)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--active-line)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--panel-hover)",
      color: "var(--fg)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 12px",
    },
  },
  { dark: true },
);

/**
 * フォントサイズを動的に切り替えるテーマ。Compartment.reconfigure に渡して使う。
 * `"&"` はエディタのルート要素（`.cm-editor`）に効く。
 */
export function fontSizeTheme(px: number): Extension {
  return EditorView.theme({
    "&": { fontSize: px + "px" },
  });
}
