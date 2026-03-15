/**
 * TMD 编辑器面板 — CodeMirror 6
 *
 * 功能:
 * - TMD 源码编辑
 * - 上下文感知智能补全（由 src/core/completion/ 提供，可扩展）
 * - 错误/警告详情展示
 */
import { useRef, useEffect, useState } from 'react';
import { FileText, CircleX, TriangleAlert, CircleCheck } from 'lucide-react';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { createTmdCompletion, type CompletionData } from '../../core/completion';
import { tmdExtensions } from '../../core/highlight';
import type { PipelineError, PipelineWarning } from '../../core/pipeline';

interface EditorPaneProps {
  source: string;
  onChange: (source: string) => void;
  errors: PipelineError[];
  warnings: PipelineWarning[];
  /** 补全数据源 — 和弦名、节奏型 ID、段落名 */
  completionData?: CompletionData;
  /** 保存反馈消息 */
  saveMessage?: string | null;
}

const EMPTY_DATA: CompletionData = { chordNames: [], rhythmIds: [], segmentNames: [] };

export function EditorPane({ source, onChange, errors, warnings, completionData, saveMessage }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dataRef = useRef<CompletionData>(completionData ?? EMPTY_DATA);
  dataRef.current = completionData ?? EMPTY_DATA;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // 初始化 CodeMirror（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          onChangeRef.current(update.state.doc.toString());
        }, 500);
      }
    });

    const tmdCompletion = createTmdCompletion(dataRef);

    const state = EditorState.create({
      doc: source,
      extensions: [
        ...tmdExtensions,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        history(),
        autocompletion({
          override: [tmdCompletion],
          activateOnTyping: true,
        }),
        cmPlaceholder('在此输入 TabMarkdown...'),
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
          '.cm-content': { padding: '12px 16px', caretColor: 'var(--accent)' },
          '.cm-line': { lineHeight: '1.6' },
          '.cm-gutters': { display: 'none' },
          '&.cm-focused': { outline: 'none' },
          '.cm-tooltip-autocomplete': {
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            boxShadow: 'var(--shadow-md)',
            fontSize: '12px',
          },
          '.cm-tooltip-autocomplete ul li': {
            padding: '4px 8px',
          },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部 source 变化时同步到编辑器（如切换项目）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== source) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: source },
      });
    }
  }, [source]);

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasDiagnostics = hasErrors || hasWarnings;

  return (
    <div className="editor-pane">
      <div className="pane-toolbar">
        <span className="pane-title"><FileText size={13} /> TabMarkdown</span>
        <div className="editor-status">
          {saveMessage ? (
            <span className="status-saved" key={saveMessage}><CircleCheck size={12} /> {saveMessage}</span>
          ) : hasErrors ? (
            <button
              className="status-btn status-btn--error"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              title={errors.map(e => e.message).join('\n')}
            >
              <CircleX size={12} /> {errors.length}
            </button>
          ) : hasWarnings ? (
            <button
              className="status-btn status-btn--warn"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              title={warnings.map(w => w.message).join('\n')}
            >
              <TriangleAlert size={12} /> {warnings.length}
            </button>
          ) : (
            <span className="status-ok"><CircleCheck size={12} /></span>
          )}
        </div>
      </div>

      {showDiagnostics && hasDiagnostics && (
        <div className="diagnostics-panel">
          {errors.map((e, i) => (
            <div key={`e-${i}`} className="diag-item diag-item--error">
              <span className="diag-phase">[{e.phase}]</span>
              {e.line != null && <span className="diag-line">L{e.line}</span>}
              <span className="diag-msg">{e.message}</span>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w-${i}`} className="diag-item diag-item--warn">
              <span className="diag-phase">[{w.phase}]</span>
              {w.line != null && <span className="diag-line">L{w.line}</span>}
              <span className="diag-msg">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <div ref={containerRef} className="tmd-editor" />
    </div>
  );
}
