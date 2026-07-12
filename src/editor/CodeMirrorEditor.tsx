import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createExtensions, programmaticUpdate } from "./setup";
import { fontSizeTheme } from "./theme";

export interface CodeMirrorHandle {
  /** 新規タブ作成時などに外部から編集面へフォーカスする（TC-201）。 */
  focus: () => void;
}

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (doc: string) => void;
  fontSizePx: number;
  testId?: string;
}

/**
 * CodeMirror 6 の React ラッパ（S-03 §4.2）。
 *
 * - mount で EditorView を1回だけ生成、unmount で destroy。
 * - `value` prop がタブ切替等の外部要因で現在 doc と食い違ったときのみ、
 *   programmaticUpdate 注釈付きで doc を全置換する（onChange は発火しない）。
 * - `fontSizePx` 変更時は Compartment.reconfigure でフォントサイズだけ差し替え。
 *
 * onChange は最新の value を参照するため ref に退避し、EditorView は再生成しない。
 */
export const CodeMirrorEditor = forwardRef<CodeMirrorHandle, CodeMirrorEditorProps>(
  function CodeMirrorEditor({ value, onChange, fontSizePx, testId }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const fontCompartmentRef = useRef(new Compartment());

    // 最新の onChange を常に参照（EditorView は再生成しない）
    onChangeRef.current = onChange;

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
    }));

    // 生成は一度だけ。初期 doc / fontSize は初回 props を使う。
    useEffect(() => {
      if (!hostRef.current) return;
      const view = new EditorView({
        parent: hostRef.current,
        doc: value,
        extensions: createExtensions({
          onChange: (doc) => onChangeRef.current(doc),
          fontSizeCompartment: fontCompartmentRef.current,
          fontSizePx,
        }),
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // 意図的に mount 時のみ実行（value/fontSizePx の後続変更は別 effect で反映）
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 外部から value が変わった（タブ切替）→ 現在 doc と異なるときだけ全置換。
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        annotations: programmaticUpdate.of(true),
      });
    }, [value]);

    // フォントサイズ変更 → Compartment.reconfigure で該当テーマのみ差し替え。
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: fontCompartmentRef.current.reconfigure(fontSizeTheme(fontSizePx)),
      });
    }, [fontSizePx]);

    return <div ref={hostRef} className="cm-host" data-testid={testId} />;
  },
);
