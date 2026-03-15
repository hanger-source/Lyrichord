/**
 * TMD 编辑器面板
 *
 * 功能: TMD 源码编辑、错误/警告详情展示
 */
import { useRef, useCallback, useEffect, useState } from 'react';
import { FileText, CircleX, TriangleAlert, CircleCheck } from 'lucide-react';
import type { PipelineError, PipelineWarning } from '../../core/pipeline';

interface EditorPaneProps {
  source: string;
  onChange: (source: string) => void;
  errors: PipelineError[];
  warnings: PipelineWarning[];
}

export function EditorPane({ source, onChange, errors, warnings }: EditorPaneProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(value), 500);
  }, [onChange]);

  // 外部 source 变化时同步到 textarea
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== source) {
      textareaRef.current.value = source;
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
          {hasErrors && (
            <button
              className="status-btn status-btn--error"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              title={errors.map(e => e.message).join('\n')}
            >
              <CircleX size={12} /> {errors.length}
            </button>
          )}
          {hasWarnings && (
            <button
              className="status-btn status-btn--warn"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              title={warnings.map(w => w.message).join('\n')}
            >
              <TriangleAlert size={12} /> {warnings.length}
            </button>
          )}
          {!hasDiagnostics && <span className="status-ok"><CircleCheck size={12} /></span>}
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

      <textarea
        ref={textareaRef}
        className="tmd-editor"
        defaultValue={source}
        onChange={handleInput}
        spellCheck={false}
        placeholder="在此输入 TabMarkdown..."
      />
    </div>
  );
}
