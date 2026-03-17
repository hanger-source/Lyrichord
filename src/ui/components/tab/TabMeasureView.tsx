/**
 * 单个小节的渲染组件
 *
 * 包含：小节号 + 拍号标签行 + 和弦区间行 + 弦线区
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { TabMeasure } from '../TabEditor';

// ---- 常量 ----
const STRING_COUNT = 6;
const BASE_W = 36;
const MIN_W = 14;

// ---- 工具函数 ----
export function beatWidth(b: { weight: number }): number { return Math.max(MIN_W, Math.round(b.weight * BASE_W)); }
export function beatX(m: TabMeasure, bi: number): number { let x = 0; for (let i = 0; i < bi; i++) x += beatWidth(m.beats[i]); return x; }
export function measureWidth(m: TabMeasure): number { return m.beats.reduce((s, b) => s + beatWidth(b), 0) + 10; }

type BeatKind = 'normal' | 'split' | 'merged';
function beatKind(b: { weight: number }): BeatKind { if (b.weight < 1) return 'split'; if (b.weight > 1) return 'merged'; return 'normal'; }

function groupLabel(group: number): string { return String(group + 1); }

function beatBg(b: { weight: number; group: number }, selected: boolean): string {
  if (selected) return 'var(--beat-sel-bg)';
  const k = beatKind(b);
  if (k === 'split') return b.group % 2 === 0 ? 'var(--split-bg)' : 'var(--split-bg-alt)';
  if (k === 'merged') return b.group % 2 === 0 ? 'var(--merge-bg)' : 'var(--merge-bg-alt)';
  return b.group % 2 === 0 ? 'var(--beat-group-a)' : 'var(--beat-group-b)';
}

function beatBorderLeft(b: { weight: number; group: number }, bi: number, m: TabMeasure): string {
  const gs = bi === 0 || m.beats[bi - 1].group !== b.group;
  if (gs) return beatKind(b) === 'merged' ? '3px solid var(--merge-color)' : '2px solid var(--beat-group-border)';
  if (beatKind(b) === 'split') return '1px dashed var(--split-dash)';
  return 'none';
}

function beatLabelContent(b: { weight: number; group: number }, bi: number, m: TabMeasure): string {
  const gs = bi === 0 || m.beats[bi - 1].group !== b.group;
  const k = beatKind(b);
  if (k === 'merged') { if (b.weight >= 4) return '𝅝'; if (b.weight >= 2) return '♩'; return gs ? groupLabel(b.group) : ''; }
  if (k === 'split') return gs ? groupLabel(b.group) : '·';
  return gs ? groupLabel(b.group) : '';
}

// ---- Props ----
interface TabMeasureViewProps {
  measure: TabMeasure;
  mi: number;
  // 拍选中（顶部，拆拍/合拍）
  isBeatSelected: (bi: number) => boolean;
  onBeatDragStart: (bi: number) => void;
  onBeatDragEnter: (bi: number) => void;
  // 节奏型拍选中（底部）
  isRhythmSelected: (bi: number) => boolean;
  onRhythmDragStart: (bi: number) => void;
  onRhythmDragEnter: (bi: number) => void;
  // 和弦拖选
  isDragHL: (bi: number) => boolean;
  isPendingHL: (bi: number) => boolean;
  onChordMouseDown: (bi: number) => void;
  onChordMouseEnter: (bi: number) => void;
  onChordClick: (chordName: string, positionIndex?: number, fromBeat?: number) => void;
  onPendingSelClear: () => void;
  // 弦线
  focusedCell: { mi: number; bi: number; si: number } | null;
  onStringClick: (bi: number, si: number) => void;
  cellDisplay: (bi: number, si: number) => string;
  // 和弦选中高亮
  activeChord: { mi: number; fromBeat: number } | null;
  // 小节操作
  isMeasureSelected: boolean;
  onMeasureClick: (shiftKey: boolean, metaKey: boolean) => void;
  onInsertMeasureBefore: () => void;
  onInsertMeasureAfter: () => void;
  onCopyMeasures: () => void;
  onPasteAfter: () => void;
  onDeleteMeasures: () => void;
  hasClipboard: boolean;
  measureCount: number;
  measureSelCount: number;
}

export function TabMeasureView({
  measure: m, mi,
  isBeatSelected, onBeatDragStart, onBeatDragEnter,
  isRhythmSelected, onRhythmDragStart, onRhythmDragEnter,
  isDragHL, isPendingHL, onChordMouseDown, onChordMouseEnter,
  onChordClick, onPendingSelClear,
  focusedCell, onStringClick, cellDisplay,
  activeChord,
  isMeasureSelected, onMeasureClick,
  onInsertMeasureBefore, onInsertMeasureAfter,
  onCopyMeasures, onPasteAfter, onDeleteMeasures,
  hasClipboard, measureCount, measureSelCount,
}: TabMeasureViewProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const handleBarlineClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onMeasureClick(e.shiftKey, e.metaKey || e.ctrlKey);
  }, [onMeasureClick]);

  const handleBarlineContextMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // 如果当前小节未选中，先选中它
    if (!isMeasureSelected) onMeasureClick(false, false);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [isMeasureSelected, onMeasureClick]);

  return (
    <div className={`tab-measure-wrap ${isMeasureSelected ? 'tab-measure-wrap--selected' : ''}`}>
      <div className="tab-measure-num">
        {mi + 1}
      </div>
      <div className="tab-measure-body">
        {/* 拍号标签行 */}
        <div className="tab-beat-labels-row">
          {m.beats.map((b, bi) => {
            const w = beatWidth(b); const sel = isBeatSelected(bi); const k = beatKind(b);
            const gs = bi === 0 || m.beats[bi - 1].group !== b.group;
            const ge = bi === m.beats.length - 1 || m.beats[bi + 1].group !== b.group;
            const multi = !gs || !ge;
            return (
              <div key={bi} className={`tab-beat-label tab-beat-label-clickable ${sel ? 'selected' : ''}`}
                style={{ width: w, background: beatBg(b, sel), borderLeft: beatBorderLeft(b, bi, m) }}
                onMouseDown={e => { e.preventDefault(); onBeatDragStart(bi); }}
                onMouseEnter={() => onBeatDragEnter(bi)}>
                {k === 'split' && multi && <span className="tab-split-bracket" style={{
                  borderLeft: gs ? '2px solid var(--split-color)' : 'none',
                  borderRight: ge ? '2px solid var(--split-color)' : 'none',
                  borderTop: '2px solid var(--split-color)',
                }} />}
                {k === 'merged' && <span className="tab-merge-bar" />}
                <span className="tab-beat-label-text">{beatLabelContent(b, bi, m)}</span>
              </div>
            );
          })}
        </div>
        {/* 和弦区间行 */}
        <div className="tab-chord-row" style={{ width: m.beats.reduce((s, b) => s + beatWidth(b), 0) }}>
          {m.chords.map((c, ci) => {
            const isActive = activeChord?.mi === mi && activeChord?.fromBeat === c.fromBeat;
            return (
            <div key={ci} className={`tab-chord-region ${isActive ? 'tab-chord-region--active' : ''}`}
              style={{ left: beatX(m, c.fromBeat), width: beatX(m, c.toBeat) - beatX(m, c.fromBeat) }}
              onClick={e => { e.stopPropagation(); onPendingSelClear(); onChordClick(c.name, c.positionIndex, c.fromBeat); }}
              onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}>
              <span className="tab-chord-region-name">{c.name}</span>
            </div>
            );
          })}
          {m.beats.map((b, bi) => (
            <div key={bi}
              className={`tab-chord-drag-cell ${isDragHL(bi) ? 'dragging' : ''} ${isPendingHL(bi) ? 'pending' : ''}`}
              style={{ left: beatX(m, bi), width: beatWidth(b) }}
              onMouseDown={e => { e.preventDefault(); onChordMouseDown(bi); }}
              onMouseEnter={() => onChordMouseEnter(bi)} />
          ))}
        </div>
        {/* 弦线区 */}
        <div className="tab-strings-area">
          {m.beats.map((b, bi) => {
            const w = beatWidth(b); const sel = isBeatSelected(bi);
            return (
              <div key={bi} className="tab-beat-col"
                style={{ width: w, background: beatBg(b, sel), borderLeft: beatBorderLeft(b, bi, m) }}>
                {m.beats[bi].rest && (
                  <div className="tab-rest-indicator" title="休止符">
                    <svg width="10" height="20" viewBox="0 0 10 20">
                      <path d="M7 2 L3 8 L7 8 L2 14 M4 14 Q6 14 6 16 Q6 19 3 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
                {Array.from({ length: STRING_COUNT }, (__, si) => {
                  const d = cellDisplay(bi, si);
                  const focused = focusedCell?.mi === mi && focusedCell?.bi === bi && focusedCell?.si === si;
                  return (
                    <div key={si}
                      className={`tab-string-cell ${focused ? 'tab-cell-focused' : ''}`}
                      onClick={() => onStringClick(bi, si)}>
                      <div className="tab-string-line" />
                      {d ? <span className={`tab-fret-display ${d === '×' ? 'is-x' : 'is-num'}`}>{d}</span> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className={`tab-barline-zone ${isMeasureSelected ? 'tab-barline-zone--selected' : ''}`}
            title="点击选中小节，Shift 多选，右键菜单"
            onClick={handleBarlineClick}
            onContextMenu={handleBarlineContextMenu}
          >
            <div className="tab-barline" />
          </div>
        </div>
        {/* 底部节奏型行 — 显示扫弦/拨弦方向 + rhythmId 标签 */}
        <div className="tab-rhythm-drag-row">
          {(() => {
            // 按 rhythmId + rhythmSeq 切分区间
            const labels: { rid: string; fromBi: number; toBi: number }[] = [];
            let cur: { rid: string; seq: number | undefined; fromBi: number; toBi: number } | null = null;
            for (let bi = 0; bi < m.beats.length; bi++) {
              const rid = m.beats[bi].rhythmId;
              const seq = m.beats[bi].rhythmSeq;
              if (rid) {
                if (cur && cur.rid === rid && cur.seq === seq && cur.toBi === bi) {
                  cur.toBi = bi + 1;
                } else {
                  if (cur) labels.push({ rid: cur.rid, fromBi: cur.fromBi, toBi: cur.toBi });
                  cur = { rid, seq, fromBi: bi, toBi: bi + 1 };
                }
              } else {
                if (cur) { labels.push({ rid: cur.rid, fromBi: cur.fromBi, toBi: cur.toBi }); cur = null; }
              }
            }
            if (cur) labels.push({ rid: cur.rid, fromBi: cur.fromBi, toBi: cur.toBi });
            return labels.map((l, i) => (
              <div key={`rid-${i}`} className="tab-rhythm-id-label"
                title={`节奏型: @${l.rid}`}
                style={{ left: beatX(m, l.fromBi), width: beatX(m, l.toBi) - beatX(m, l.fromBi) }}>
                @{l.rid}
              </div>
            ));
          })()}
          {m.beats.map((b, bi) => {
            const w = beatWidth(b);
            const sel = isRhythmSelected(bi);
            // 根据 brush 显示节奏型符号
            let icon = '♩';
            if (b.brush === 'ad') icon = '↓';
            else if (b.brush === 'au') icon = '↑';
            else if (b.brush === 'ds') icon = 'X';
            // 检查是否有弦内容但没有 brush（拨弦）
            else if (b.strings.some(s => s.type !== 'none') && !b.rest) icon = '·';
            return (
              <div key={bi}
                className={`tab-rhythm-drag-cell ${sel ? 'selected' : ''}`}
                style={{ width: w, borderLeft: beatBorderLeft(b, bi, m) }}
                onMouseDown={e => { e.preventDefault(); onRhythmDragStart(bi); }}
                onMouseEnter={() => onRhythmDragEnter(bi)}>
                <span className="tab-rhythm-drag-icon">{icon}</span>
              </div>
            );
          })}
        </div>
      </div>
      {ctxMenu && (
        <div ref={ctxRef} className="tab-measure-ctx-menu" style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 100 }}>
          <div className="tab-ctx-menu-item" onClick={() => { onInsertMeasureBefore(); setCtxMenu(null); }}>前插空小节</div>
          <div className="tab-ctx-menu-item" onClick={() => { onInsertMeasureAfter(); setCtxMenu(null); }}>后插空小节</div>
          <div className="tab-ctx-menu-item" onClick={() => { onCopyMeasures(); setCtxMenu(null); }}>
            复制{measureSelCount > 1 ? ` ${measureSelCount} 小节` : '小节'}
          </div>
          {hasClipboard && (
            <div className="tab-ctx-menu-item" onClick={() => { onPasteAfter(); setCtxMenu(null); }}>粘贴到后方</div>
          )}
          {measureCount > 1 && (
            <div className="tab-ctx-menu-item tab-ctx-menu-item--danger" onClick={() => { onDeleteMeasures(); setCtxMenu(null); }}>
              删除{measureSelCount > 1 ? ` ${measureSelCount} 小节` : '小节'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
