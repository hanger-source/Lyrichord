/**
 * TAB 编辑器 v8 — 重构版
 *
 * 职责：六线谱网格编辑，段落管理由 TabWorkspace 处理。
 * 子组件：TabToolbar（工具栏）、TabMeasureView（小节渲染）
 */
import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { resolveChord } from '../../core/chord/resolver';
import { parseTmdToMeasures } from '../../core/tmd-to-measures';
import { TabToolbar } from './tab/TabToolbar';
import { TabMeasureView, measureWidth, beatWidth } from './tab/TabMeasureView';

// ---- 数据模型 ----

export type StringMark =
  | { type: 'none' }
  | { type: 'chord' }
  | { type: 'custom'; fret: number };

export type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];

export interface ChordRegion {
  fromBeat: number;
  toBeat: number;
  name: string;
}

export interface TabBeat {
  strings: Strings6;
  weight: number;
  group: number;
  rest?: boolean;
}

export interface TabMeasure {
  beats: TabBeat[];
  chords: ChordRegion[];
}

export interface ChordSelectionPending {
  measureIdx: number;
  fromBeat: number;
  toBeat: number;
}

// ---- 常量 ----
const STRING_COUNT = 6;
const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
const LABEL_W = 28;
const TIME_SIGS: [string, number][] = [['3/4', 6], ['4/4', 8], ['6/8', 6]];

// ---- 工具函数 ----

function emptyStrings(): Strings6 {
  return [
    { type: 'none' }, { type: 'none' }, { type: 'none' },
    { type: 'none' }, { type: 'none' }, { type: 'none' },
  ];
}

function mkBeat(weight: number, group: number): TabBeat {
  return { strings: emptyStrings(), weight, group };
}

export function mkMeasure(bpm: number): TabMeasure {
  const beats: TabBeat[] = [];
  for (let i = 0; i < bpm; i++) beats.push(mkBeat(1, Math.floor(i / 2)));
  return { beats, chords: [] };
}

function chordAt(measures: TabMeasure[], mi: number, bi: number): string | null {
  const mc = measures[mi].chords;
  for (let i = mc.length - 1; i >= 0; i--) {
    if (mc[i].fromBeat <= bi && bi < mc[i].toBeat) return mc[i].name;
  }
  for (let m = mi - 1; m >= 0; m--) {
    const prev = measures[m].chords;
    if (prev.length > 0) return prev[prev.length - 1].name;
  }
  return null;
}

function chordFretForString(name: string, si: number): number {
  const def = resolveChord(name);
  if (!def) return 0;
  return def.frets[5 - si];
}

function hasContent(m: TabMeasure): boolean {
  if (m.chords.length > 0) return true;
  return m.beats.some(b => b.rest || b.strings.some(s => s.type !== 'none'));
}

function weightToDur(w: number): number {
  if (w >= 2) return 4; if (w >= 1) return 8; if (w >= 0.5) return 16; return 32;
}

function mToTex(m: TabMeasure, measures: TabMeasure[], mi: number): string {
  const parts: string[] = [];
  for (let bi = 0; bi < m.beats.length; bi++) {
    const beat = m.beats[bi];
    const ch = chordAt(measures, mi, bi);
    const dur = weightToDur(beat.weight);
    const notes: { fret: number; str: number }[] = [];
    for (let si = 0; si < STRING_COUNT; si++) {
      const mk = beat.strings[si];
      if (mk.type === 'chord' && ch) {
        const f = chordFretForString(ch, si);
        if (f >= 0) notes.push({ fret: f, str: si + 1 });
      } else if (mk.type === 'custom') {
        notes.push({ fret: mk.fret, str: si + 1 });
      }
    }
    const chordMark = m.chords.find(c => c.fromBeat === bi);
    const pfx = chordMark ? `[${chordMark.name}]` : '';
    if (beat.rest || notes.length === 0) parts.push(`${pfx}r.${dur}`);
    else if (notes.length === 1) parts.push(`${pfx}${notes[0].fret}.${notes[0].str}.${dur}`);
    else parts.push(`${pfx}(${notes.map(n => `${n.fret}.${n.str}`).join(' ')}).${dur}`);
  }
  return parts.join(' ');
}

function mToChordLine(m: TabMeasure): string {
  const groups = new Map<number, string | null>();
  for (const b of m.beats) { if (!groups.has(b.group)) groups.set(b.group, null); }
  for (const c of m.chords) { if (c.fromBeat < m.beats.length) groups.set(m.beats[c.fromBeat].group, c.name); }
  return `| ${[...groups.values()].map(v => v ?? '.').join(' ')} |`;
}

function genTmd(measures: TabMeasure[]): string {
  return measures
    .map((m, i) => hasContent(m) ? `${mToChordLine(m)}\ntex: ${mToTex(m, measures, i)}` : null)
    .filter(Boolean).join('\n\n');
}

function splitRows(measures: TabMeasure[], cw: number): number[][] {
  const rows: number[][] = []; let row: number[] = []; let rowW = LABEL_W;
  for (let i = 0; i < measures.length; i++) {
    const mw = measureWidth(measures[i]);
    if (row.length > 0 && rowW + mw > cw) { rows.push(row); row = [i]; rowW = LABEL_W + mw; }
    else { row.push(i); rowW += mw; }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

// ---- 组件 Props ----

interface TabEditorProps {
  initialMeasures?: TabMeasure[] | null;
  initialBpm?: number;
  initialTsLabel?: string;
  segmentName?: string;
  onSegmentNameChange?: (name: string) => void;
  onSave?: (measures: TabMeasure[], bpm: number, tsLabel: string) => void;
  saving?: boolean;
  saveMsg?: string | null;
  isUpdate?: boolean;
  onTmdChange?: (tmd: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: string | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

export function TabEditor({
  initialMeasures, initialBpm = 8, initialTsLabel = '4/4',
  segmentName = '', onSegmentNameChange,
  onSave, saving, saveMsg, isUpdate,
  onTmdChange, onChordSelectionStart, chordToApply, onChordApplied, onChordClick,
  previewOpen, onTogglePreview,
}: TabEditorProps) {
  const [bpm, setBpm] = useState(initialBpm);
  const [tsLabel, setTsLabel] = useState(initialTsLabel);
  const [measures, setMeasures] = useState<TabMeasure[]>(() =>
    initialMeasures ?? Array.from({ length: 4 }, () => mkMeasure(initialBpm))
  );

  // ---- Undo / Redo ----
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSnapshot = useRef('');
  const pushUndo = useCallback((prev: TabMeasure[]) => {
    const snap = JSON.stringify(prev);
    if (snap === lastSnapshot.current) return;
    undoStack.current.push(snap);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    lastSnapshot.current = snap;
  }, []);
  const updateMeasures = useCallback((updater: (prev: TabMeasure[]) => TabMeasure[]) => {
    setMeasures(prev => { const next = updater(prev); if (next !== prev) pushUndo(prev); return next; });
  }, [pushUndo]);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current.pop()!;
    setMeasures(prev => { redoStack.current.push(JSON.stringify(prev)); lastSnapshot.current = snap; return JSON.parse(snap); });
  }, []);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current.pop()!;
    setMeasures(prev => { undoStack.current.push(JSON.stringify(prev)); lastSnapshot.current = snap; return JSON.parse(snap); });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ---- 交互状态 ----
  const [dragState, setDragState] = useState<{ mi: number; startBi: number; endBi: number } | null>(null);
  const [pendingSel, setPendingSel] = useState<ChordSelectionPending | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ mi: number; bi: number; si: number } | null>(null);
  const [beatSel, setBeatSel] = useState<{ mi: number; from: number; to: number } | null>(null);
  const [beatDrag, setBeatDrag] = useState<{ mi: number; start: number; end: number } | null>(null);
  const [containerW, setContainerW] = useState(900);
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = gridRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setContainerW(e.contentRect.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const addMeasure = useCallback(() => updateMeasures(prev => [...prev, mkMeasure(bpm)]), [bpm, updateMeasures]);
  const removeLastMeasure = useCallback(() => updateMeasures(prev => prev.length <= 1 ? prev : prev.slice(0, -1)), [updateMeasures]);

  // 和弦填入
  useEffect(() => {
    if (chordToApply && pendingSel) {
      const { measureIdx: mi, fromBeat, toBeat } = pendingSel;
      updateMeasures(prev => {
        const next = structuredClone(prev);
        next[mi].chords = next[mi].chords.filter(c => c.toBeat <= fromBeat || c.fromBeat >= toBeat);
        next[mi].chords.push({ fromBeat, toBeat, name: chordToApply });
        next[mi].chords.sort((a, b) => a.fromBeat - b.fromBeat);
        return next;
      });
      setPendingSel(null);
      onChordApplied?.();
    }
  }, [chordToApply, pendingSel, onChordApplied, updateMeasures]);

  const rows = useMemo(() => splitRows(measures, containerW), [measures, containerW]);
  const tmdText = useMemo(() => genTmd(measures), [measures]);
  useEffect(() => { onTmdChange?.(tmdText); }, [tmdText, onTmdChange]);

  // TMD 折叠面板 — 编辑草稿
  const [tmdDraft, setTmdDraft] = useState<string | null>(null);
  const handleImportTmd = useCallback(() => {
    if (!tmdDraft) return;
    const parsed = parseTmdToMeasures(tmdDraft);
    if (parsed.length > 0) {
      updateMeasures(() => parsed);
      setTmdDraft(null);
    }
  }, [tmdDraft, updateMeasures]);

  // ---- 和弦拖选 ----
  const handleChordMouseDown = useCallback((mi: number, bi: number) => setDragState({ mi, startBi: bi, endBi: bi }), []);
  const handleChordMouseEnter = useCallback((mi: number, bi: number) => setDragState(prev => prev && prev.mi === mi ? { ...prev, endBi: bi } : prev), []);
  const handleChordMouseUp = useCallback(() => {
    if (!dragState) return;
    const from = Math.min(dragState.startBi, dragState.endBi);
    const to = Math.max(dragState.startBi, dragState.endBi) + 1;
    const sel: ChordSelectionPending = { measureIdx: dragState.mi, fromBeat: from, toBeat: to };
    setPendingSel(sel); onChordSelectionStart?.(sel); setDragState(null);
  }, [dragState, onChordSelectionStart]);
  useEffect(() => { const up = () => { if (dragState) handleChordMouseUp(); }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, [dragState, handleChordMouseUp]);

  const removeChordAt = useCallback((mi: number, bi: number) => {
    updateMeasures(prev => { const next = structuredClone(prev); next[mi].chords = next[mi].chords.filter(c => !(c.fromBeat <= bi && bi < c.toBeat)); return next; });
  }, [updateMeasures]);

  // ---- 拍选中 ----
  const handleBeatDragStart = useCallback((mi: number, bi: number) => { setBeatDrag({ mi, start: bi, end: bi }); setBeatSel(null); }, []);
  const handleBeatDragEnter = useCallback((mi: number, bi: number) => setBeatDrag(prev => prev && prev.mi === mi ? { ...prev, end: bi } : prev), []);
  const handleBeatDragEnd = useCallback(() => {
    if (!beatDrag) return;
    setBeatSel({ mi: beatDrag.mi, from: Math.min(beatDrag.start, beatDrag.end), to: Math.max(beatDrag.start, beatDrag.end) });
    setBeatDrag(null);
  }, [beatDrag]);
  useEffect(() => { const up = () => { if (beatDrag) handleBeatDragEnd(); }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, [beatDrag, handleBeatDragEnd]);

  const isBeatInSel = (mi: number, bi: number): boolean => {
    if (beatDrag && beatDrag.mi === mi) { const [a, b] = [Math.min(beatDrag.start, beatDrag.end), Math.max(beatDrag.start, beatDrag.end)]; return bi >= a && bi <= b; }
    if (beatSel && beatSel.mi === mi) return bi >= beatSel.from && bi <= beatSel.to;
    return false;
  };
  const selCount = beatSel ? beatSel.to - beatSel.from + 1 : 0;

  // ---- 拆拍/合拍 ----
  const splitBeat = useCallback(() => {
    if (!beatSel) return;
    const { mi, from, to } = beatSel;
    updateMeasures(prev => {
      const next = structuredClone(prev); const m = next[mi];
      for (let bi = to; bi >= from; bi--) {
        const b = m.beats[bi]; if (b.weight < 0.25) continue;
        const halfW = b.weight / 2; b.weight = halfW;
        m.beats.splice(bi + 1, 0, mkBeat(halfW, b.group));
        for (const c of m.chords) { if (c.fromBeat > bi) c.fromBeat++; if (c.toBeat > bi) c.toBeat++; }
      }
      return next;
    });
    setBeatSel(null);
  }, [beatSel, updateMeasures]);

  const mergeBeats = useCallback(() => {
    if (!beatSel || selCount < 2) return;
    const { mi, from, to } = beatSel;
    updateMeasures(prev => {
      const next = structuredClone(prev); const m = next[mi];
      let totalW = 0; for (let i = from; i <= to; i++) totalW += m.beats[i].weight;
      const keep = m.beats[from];
      if (keep.strings.every(s => s.type === 'none')) {
        for (let i = from + 1; i <= to; i++) { if (m.beats[i].strings.some(s => s.type !== 'none')) { keep.strings = m.beats[i].strings; break; } }
      }
      keep.weight = totalW;
      const rc = to - from; m.beats.splice(from + 1, rc);
      for (const c of m.chords) { if (c.fromBeat > from) c.fromBeat = Math.max(from, c.fromBeat - rc); if (c.toBeat > from + 1) c.toBeat = Math.max(from + 1, c.toBeat - rc); }
      m.chords = m.chords.filter(c => c.toBeat > c.fromBeat);
      return next;
    });
    setBeatSel(null);
  }, [beatSel, selCount, updateMeasures]);

  const toggleRestForSel = useCallback(() => {
    if (!beatSel) return;
    updateMeasures(prev => {
      const next = structuredClone(prev);
      for (let bi = beatSel.from; bi <= beatSel.to; bi++) {
        const beat = next[beatSel.mi].beats[bi]; beat.rest = !beat.rest;
        if (beat.rest) beat.strings = emptyStrings();
      }
      return next;
    });
    setBeatSel(null);
  }, [beatSel, updateMeasures]);

  // ---- 弦线交互 ----
  const handleStringClick = useCallback((mi: number, bi: number, si: number) => {
    const ch = chordAt(measures, mi, bi);
    const cur = measures[mi]?.beats[bi]?.strings[si]; if (!cur) return;
    if (cur.type === 'none' && ch) {
      updateMeasures(prev => { const next = structuredClone(prev); next[mi].beats[bi].strings[si] = { type: 'chord' }; return next; });
    }
    setFocusedCell({ mi, bi, si });
  }, [measures, updateMeasures]);

  useEffect(() => {
    if (!focusedCell) return;
    const handler = (e: KeyboardEvent) => {
      const { mi, bi, si } = focusedCell;
      if (e.key === 'Escape') { setFocusedCell(null); return; }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        updateMeasures(prev => { const next = structuredClone(prev); const beat = next[mi].beats[bi]; beat.rest = !beat.rest; if (beat.rest) beat.strings = emptyStrings(); return next; });
        setFocusedCell(null); return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        updateMeasures(prev => { const next = structuredClone(prev); next[mi].beats[bi].strings[si] = { type: 'none' }; return next; });
        setFocusedCell(null); return;
      }
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 0 && num <= 9) {
        e.preventDefault();
        updateMeasures(prev => {
          const next = structuredClone(prev);
          const cur = prev[mi].beats[bi].strings[si];
          let fret = num;
          if (cur.type === 'custom' && cur.fret < 10) { const td = cur.fret * 10 + num; if (td <= 24) fret = td; }
          next[mi].beats[bi].strings[si] = { type: 'custom', fret };
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedCell, updateMeasures]);

  const handleTsChange = useCallback((label: string, b: number) => {
    setTsLabel(label); setBpm(b); setMeasures([mkMeasure(b)]); setBeatSel(null);
  }, []);

  const cellDisplay = (mi: number, bi: number, si: number): string => {
    const mk = measures[mi]?.beats[bi]?.strings[si];
    if (!mk || mk.type === 'none') return '';
    return mk.type === 'chord' ? '×' : String(mk.fret);
  };

  const isDragHL = (mi: number, bi: number) => { if (!dragState || dragState.mi !== mi) return false; const [a, b] = [Math.min(dragState.startBi, dragState.endBi), Math.max(dragState.startBi, dragState.endBi)]; return bi >= a && bi <= b; };
  const isPendingHL = (mi: number, bi: number) => { if (!pendingSel || pendingSel.measureIdx !== mi) return false; return bi >= pendingSel.fromBeat && bi < pendingSel.toBeat; };

  // ---- 渲染 ----
  return (
    <div className="tab-editor-v2">
      <TabToolbar
        segmentName={segmentName}
        onSegmentNameChange={n => onSegmentNameChange?.(n)}
        onSave={() => onSave?.(measures, bpm, tsLabel)}
        saving={!!saving}
        saveMsg={saveMsg ?? null}
        isUpdate={!!isUpdate}
        onUndo={undo}
        onRedo={redo}
        beatSelCount={selCount}
        onSplitBeat={splitBeat}
        onMergeBeats={mergeBeats}
        onToggleRest={toggleRestForSel}
        onCancelBeatSel={() => setBeatSel(null)}
        hasPendingSel={!!pendingSel}
        tsLabel={tsLabel}
        onTsChange={handleTsChange}
        timeSigs={TIME_SIGS}
        measureCount={measures.length}
        onAddMeasure={addMeasure}
        onRemoveMeasure={removeLastMeasure}
        previewOpen={previewOpen}
        onTogglePreview={onTogglePreview}
      />

      {/* 谱面 */}
      <div className="tab-grid-scroll" ref={gridRef}>
        {rows.map((rowMis, ri) => (
          <div key={ri} className="tab-row">
            <div className="tab-string-labels">
              <div className="tab-label-num-row" />
              <div className="tab-label-beat-row" />
              <div className="tab-label-chord-row" />
              {STRING_NAMES.map((n, si) => <div key={si} className="tab-string-name">{n}</div>)}
            </div>
            {rowMis.map(mi => (
              <TabMeasureView
                key={mi}
                measure={measures[mi]}
                mi={mi}
                isBeatSelected={bi => isBeatInSel(mi, bi)}
                onBeatDragStart={bi => handleBeatDragStart(mi, bi)}
                onBeatDragEnter={bi => handleBeatDragEnter(mi, bi)}
                isDragHL={bi => isDragHL(mi, bi)}
                isPendingHL={bi => isPendingHL(mi, bi)}
                onChordMouseDown={bi => handleChordMouseDown(mi, bi)}
                onChordMouseEnter={bi => handleChordMouseEnter(mi, bi)}
                onChordClick={name => onChordClick?.(name)}
                onChordRemove={bi => removeChordAt(mi, bi)}
                onPendingSelClear={() => setPendingSel(null)}
                focusedCell={focusedCell}
                onStringClick={(bi, si) => handleStringClick(mi, bi, si)}
                cellDisplay={(bi, si) => cellDisplay(mi, bi, si)}
              />
            ))}
          </div>
        ))}
      </div>

      <Collapsible.Root className="tab-tmd-panel">
        <Collapsible.Trigger className="tab-tmd-summary">
          TMD 源码 ▸
        </Collapsible.Trigger>
        <Collapsible.Content className="tab-tmd-body">
          <textarea
            className="tab-tmd-textarea"
            value={tmdDraft ?? tmdText}
            onChange={e => setTmdDraft(e.target.value)}
            rows={8}
            spellCheck={false}
          />
          {tmdDraft !== null && tmdDraft !== tmdText && (
            <div className="tab-tmd-actions">
              <button className="tab-action-btn tab-save-btn" onClick={handleImportTmd}>应用</button>
              <button className="tab-action-btn" onClick={() => setTmdDraft(null)}>取消</button>
            </div>
          )}
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
