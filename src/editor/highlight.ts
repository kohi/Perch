import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Perch エディタのシンタックスハイライト定義（S-03 §4.2）。
 *
 * 色は必ず `tokens.css` の `--cm-*` トークン経由で参照する（直値ハードコード禁止・
 * CLAUDE.md デザイントークン規律）。`var(--cm-*)` は CodeMirror が生成する
 * インラインスタイルにそのまま乗り、`:root` の値で解決される。
 *
 * 注: ここで定義したタグに一致した本文だけが `<span class="tok-...">` として
 * DOM に現れる。未定義タグは span 化されずハイライトが効かないため、
 * keyword/string/comment/number/tagName/attributeName/propertyName/typeName/
 * variableName/operator/punctuation/heading/emphasis は必ず網羅する。
 */
export const perchHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--cm-keyword)" },
  { tag: t.operator, color: "var(--cm-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--cm-string)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "var(--cm-number)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--cm-tag)" },
  { tag: t.attributeName, color: "var(--cm-attribute)" },
  { tag: [t.propertyName, t.attributeValue], color: "var(--cm-property)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--cm-type)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--cm-variable)" },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren], color: "var(--cm-punctuation)" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3], color: "var(--cm-heading)", fontWeight: "bold" },
  { tag: [t.emphasis], color: "var(--cm-emphasis)", fontStyle: "italic" },
  { tag: [t.strong], color: "var(--cm-emphasis)", fontWeight: "bold" },
]);
