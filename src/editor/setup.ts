import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  indentUnit,
  LanguageDescription,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { perchHighlightStyle } from "./highlight";
import { perchEditorTheme, fontSizeTheme } from "./theme";

/**
 * プログラム的なドキュメント全置換（タブ切替時）に付ける注釈。
 * updateListener 側でこの注釈の有無を見て、外部更新由来の変更では onChange を
 * 発火させない（onChange→再 setState→doc 再置換 の無限ループを防ぐ）。
 * ref フラグより取りこぼしが無く CM 慣用のため、こちらを採用する。
 */
export const programmaticUpdate = Annotation.define<boolean>();

/**
 * Markdown コードフェンス内で使う言語。```html / ```js / ```css を
 * ネスト言語としてハイライトする。autoCloseTags:false で `<div>` 入力時に
 * `</div>` を自動挿入させない（タイプ内容を汚さない・自動補完排除）。
 */
const codeLanguages = [
  LanguageDescription.of({
    name: "html",
    alias: ["htm"],
    support: html({ autoCloseTags: false }),
  }),
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "jsx", "ts", "tsx", "typescript"],
    support: javascript(),
  }),
  LanguageDescription.of({
    name: "css",
    alias: ["css"],
    support: css(),
  }),
];

export interface CreateExtensionsParams {
  onChange: (doc: string) => void;
  fontSizeCompartment: Compartment;
  fontSizePx: number;
}

/**
 * Perch エディタの拡張一式（S-03 §4.2）。
 * 含めない: autocompletion / closeBrackets / search / foldGutter
 * （CLAUDE.md「やらない」節：本格 IDE 機能は VS Code に任せる）。
 */
export function createExtensions(params: CreateExtensionsParams): Extension[] {
  const { onChange, fontSizeCompartment, fontSizePx } = params;
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    syntaxHighlighting(perchHighlightStyle),
    markdown({ codeLanguages }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    perchEditorTheme,
    fontSizeCompartment.of(fontSizeTheme(fontSizePx)),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      // 外部（タブ切替）由来のプログラム的更新では onChange を発火させない
      const isProgrammatic = u.transactions.some((tr) => tr.annotation(programmaticUpdate));
      if (isProgrammatic) return;
      onChange(u.state.doc.toString());
    }),
  ];
}
