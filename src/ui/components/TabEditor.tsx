/**
 * TAB 编辑器 v8 — 重构版
 *
 * 职责：六线谱网格编辑，段落管理由 TabWorkspace 处理。
 * 子组件：TabToolbar（工具栏）、TabMeasureView（小节渲染）
 */
import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { resolveChord } from '../../core/chord/resolver';
import { parseTmdToMeasures } from '../../core/tmd-to-measures';
import { expandRhythm } from '../../core/rhythm/expander';
import type { RhythmPattern, GuitarFrets } from '../../core/types';
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
  /** 指法变体索引（对应 ChordDefinition.positions[idx]） */
  positionIndex?: number;
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

function chordAt(measures: TabMeasure[], mi: number, bi: number): ChordRegion | null {
  const mc = measures[mi].chords;
  for (let i = mc.length - 1; i >= 0; i--) {
    if (mc[i].fromBeat <= bi && bi < mc[i].toBeat) return mc[i];
  }
  for (let m = mi - 1; m >= 0; m--) {
    const prev = measures[m].chords;
    if (prev.length > 0) return prev[prev.length - 1];
  }
  return null;
}

function chordFretForString(name: string, si: number, positionIndex?: number): number {
  const def = resolveChord(name);
  if (!def) return 0;
  // positions 里的 frets 是相对品位，需要转为绝对品位
  // def.frets 已经是绝对品位（positions[0] 转换过的）
  const idx = positionIndex ?? 0;
  const pos = def.positions?.[idx];
  if (pos) {
    const relFret = pos.frets[5 - si];
    if (relFret <= 0) return relFret; // 0=空弦, -1=不弹
    return relFret + pos.baseFret - 1; // 转绝对品位
  }
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
    const region = chordAt(measures, mi, bi);
    const dur = weightToDur(beat.weight);
    const notes: { fret: number; str: number }[] = [];
    for (let si = 0; si < STRING_COUNT; si++) {
      const mk = beat.strings[si];
      if (mk.type === 'chord' && region) {
        const f = chordFretForString(region.name, si, region.positionIndex);
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

/**
 * 生成单个段落的 TMD body（不含 header）
 * 返回 [SectionName] + 小节内容，以及用到的和弦名集合
 */
export function genSectionBody(
  measures: TabMeasure[],
  sectionName?: string,
): { body: string; usedChords: ChordRegion[] } {
  const section = sectionName?.trim() || 'Untitled';
  const usedChords: ChordRegion[] = [];
  const seen = new Set<string>();
  for (const m of measures) {
    for (const c of m.chords) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        usedChords.push(c);
      }
    }
  }

  const lines = measures
    .map((m, i) => hasContent(m) ? `${mToChordLine(m)}\ntex: ${mToTex(m, measures, i)}` : null)
    .filter(Boolean).join('\n\n');

  if (!lines) return { body: '', usedChords };
  return { body: `[${section}]\n\n${lines}`, usedChords };
}

/**
 * 生成和弦 define 行
 */
/**
 * 从使用的和弦区间生成 TMD define 行
 * 每个和弦取实际使用的 positionIndex 对应的指法
 */
export function genChordDefs(chordRegions: Iterable<ChordRegion>): string[] {
  const defs: string[] = [];
  const seen = new Set<string>();
  for (const region of chordRegions) {
    if (seen.has(region.name)) continue;
    seen.add(region.name);
    const def = resolveChord(region.name);
    if (!def) continue;
    const posIdx = region.positionIndex ?? 0;
    const pos = def.positions?.[posIdx] ?? def.positions?.[0];
    const frets = pos
      ? pos.frets.map(f => {
          if (f < 0) return 'x';
          if (f === 0) return '0';
          return String(f + pos.baseFret - 1); // 转绝对品位
        }).join(' ')
      : def.frets.map(f => f < 0 ? 'x' : String(f)).join(' ');
    defs.push(`define [${region.name}]: { frets: "${frets}" }`);
  }
  return defs;
}

/**
 * 生成 TMD header
 */
export function genTmdHeader(tempo: number, tsLabel: string, chordDefs: string[]): string {
  return [
    '---',
    `tempo: ${tempo}`,
    `time_signature: ${tsLabel}`,
    ...(chordDefs.length > 0 ? ['', ...chordDefs] : []),
    '---',
  ].join('\n');
}

/**
 * 生成单段落完整 TMD（header + [Section] + body）
 * 用于单段落预览
 */
function genTmd(measures: TabMeasure[], opts?: { bpm?: number; tsLabel?: string; sectionName?: string }): string {
  const tempo = opts?.bpm ?? 72;
  const ts = opts?.tsLabel ?? '4/4';

  const { body, usedChords } = genSectionBody(measures, opts?.sectionName);
  if (!body) return '';

  const chordDefs = genChordDefs(usedChords);
  const header = genTmdHeader(tempo, ts, chordDefs);
  return `${header}\n\n${body}\n`;
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
  initialTempo?: number;
  initialBpm?: number;
  initialTsLabel?: string;
  segmentName?: string;
  onSegmentNameChange?: (name: string) => void;
  onSave?: (measures: TabMeasure[], tempo: number, bpm: number, tsLabel: string) => void;
  saving?: boolean;
  saveMsg?: string | null;
  onTmdChange?: (tmd: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: { name: string; positionIndex: number } | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string, positionIndex?: number) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

export interface TabEditorHandle {
  /** 外部触发保存（如 Ctrl+S） */
  triggerSave: () => void;
  /** 更新所有同名和弦的 positionIndex */
  updateChordPosition: (chordName: string, positionIndex: number) => void;
  /** 应用节奏型到所有有和弦的小节 */
  applyRhythm: (rhythm: RhythmPattern) => void;
}

export const TabEditor = forwardRef<TabEditorHandle, TabEditorProps>(function TabEditor({
  initialMeasures, initialTempo = 72, initialBpm = 8, initialTsLabel = '4/4',
  segmentName = '', onSegmentNameChange,
  onSave, saving, saveMsg,
  onTmdChange, onChordSelectionStart, chordToApply, onChordApplied, onChordClick,
  previewOpen, onTogglePreview,
}: TabEditorProps, ref) {
  const [tempo, setTempo] = useState(initialTempo);
  const [bpm, setBpm] = useState(initialBpm);
  const [tsLabel, setTsLabel] = useState(initialTsLabel);
  const [measures, setMeasures] = useState<TabMeasure[]>(() =>
    initialMeasures ?? Array.from({ length: 4 }, () => mkMeasure(initialBpm))
  );

  // 暴露 triggerSave 给外部（Ctrl+S）
  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  const tempoRef = useRef(initialTempo);
  const bpmRef = useRef(initialBpm);
  const tsLabelRef = useRef(initialTsLabel);

  // ---- Undo / Redo (refs 提前声明，供 useImperativeHandle 使用) ----
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSnapshot = useRef('');

  useImperativeHandle(ref, () => ({
    triggerSave() {
      onSave?.(measuresRef.current, tempoRef.current, bpmRef.current, tsLabelRef.current);
    },
    updateChordPosition(chordName: string, positionIndex: number) {
      setMeasures(prev => {
        let anyChanged = false;
        const next = prev.map(m => {
          let mChanged = false;
          const newChords = m.chords.map(c => {
            if (c.name === chordName && c.positionIndex !== positionIndex) {
              mChanged = true;
              return { ...c, positionIndex };
            }
            return c;
          });
          if (mChanged) { anyChanged = true; return { ...m, chords: newChords }; }
          return m;
        });
        return anyChanged ? next : prev;
      });
    },
    applyRhythm(rhythm: RhythmPattern) {
      setMeasures(prev => {
        // push undo snapshot
        const snap = JSON.stringify(prev);
        undoStack.current.push(snap);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
        lastSnapshot.current = snap;

        // 节奏型统一代表一整小节，slot 时值 = 小节总拍数 / slot 数量
        return prev.map(m => {
          if (m.chords.length === 0) return m;
          const next = structuredClone(m);

          const totalBeats = next.beats.reduce((s, b) => s + b.weight, 0);
          const slotCount = rhythm.slots.length;
          const beatsPerSlot = totalBeats / slotCount;

          // 计算每个 beat 的绝对拍位（累加 weight）
          const beatPositions: number[] = [];
          let pos = 0;
          for (const b of next.beats) {
            beatPositions.push(pos);
            pos += b.weight;
          }

          // 按小节内绝对位置映射 slot，不按和弦区间重置
          for (let bi = 0; bi < next.beats.length; bi++) {
            // 找当前拍位所属的和弦区间
            const chord = next.chords.find(c => c.fromBeat <= bi && bi < c.toBeat);
            if (!chord) continue; // 没有和弦覆盖的拍位不动

            const def = resolveChord(chord.name);
            if (!def) continue;
            const posIdx = chord.positionIndex ?? 0;
            const cpos = def.positions?.[posIdx];
            const frets: GuitarFrets = cpos
              ? cpos.frets.map(f => f <= 0 ? f : f + cpos.baseFret - 1) as GuitarFrets
              : def.frets;

            const beat = next.beats[bi];
            // slot 索引基于小节内绝对位置
            const slotIdx = Math.floor(beatPositions[bi] / beatsPerSlot) % slotCount;
            const slot = rhythm.slots[slotIdx];
            const strings = emptyStrings();

            // sustain → 空弦线（延音）
            if (slot.kind === 'strum' && slot.action === 'sustain') {
              beat.strings = strings;
              continue;
            }

            const events = expandRhythm(rhythm.type, [slot], frets);
            const ev = events[0];
            if (ev && !ev.isRest && !ev.isSustain) {
              for (const note of ev.notes) {
                const si = note.string - 1;
                if (si >= 0 && si < 6) {
                  strings[si] = ev.isDeadNote
                    ? { type: 'custom', fret: 0 }
                    : { type: 'custom', fret: note.fret };
                }
              }
            }
            beat.strings = strings;
          }
          return next;
        });
      });
    },
  }), [onSave]);

  // ---- Undo / Redo (callbacks) ----
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
  /** 当前选中的和弦区间（mi + fromBeat 唯一标识） */
  const [activeChord, setActiveChord] = useState<{ mi: number; fromBeat: number } | null>(null);
  const [containerW, setContainerW] = useState(900);
  const gridRef = useRef<HTMLDivElement>(null);

  const containerWRef = useRef(900);
  const rafRef = useRef(0);
  useLayoutEffect(() => {
    const el = gridRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (Math.abs(w - containerWRef.current) < 4) return; // 忽略微小变化
        containerWRef.current = w;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setContainerW(w));
      }
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, []);

  const addMeasure = useCallback(() => updateMeasures(prev => [...prev, mkMeasure(bpm)]), [bpm, updateMeasures]);
  const removeLastMeasure = useCallback(() => updateMeasures(prev => prev.length <= 1 ? prev : prev.slice(0, -1)), [updateMeasures]);

  // 和弦填入：chordToApply + pendingSel 同时存在时填入
  useEffect(() => {
    if (chordToApply && pendingSel) {
      const { measureIdx: mi, fromBeat, toBeat } = pendingSel;
      updateMeasures(prev => {
        const next = structuredClone(prev);
        next[mi].chords = next[mi].chords.filter(c => c.toBeat <= fromBeat || c.fromBeat >= toBeat);
        next[mi].chords.push({ fromBeat, toBeat, name: chordToApply.name, positionIndex: chordToApply.positionIndex });
        next[mi].chords.sort((a, b) => a.fromBeat - b.fromBeat);
        return next;
      });
      setPendingSel(null);
      onChordApplied?.();
    }
  }, [chordToApply, pendingSel, onChordApplied, updateMeasures]);

  // Escape 取消 pendingSel 和 chordToApply
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingSel) { setPendingSel(null); }
        if (chordToApply) { onChordApplied?.(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingSel, chordToApply, onChordApplied]);

  const rows = useMemo(() => splitRows(measures, containerW), [measures, containerW]);
  const tmdText = useMemo(() => genTmd(measures, { bpm: tempo, tsLabel, sectionName: segmentName }), [measures, tempo, tsLabel, segmentName]);
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
    tsLabelRef.current = label; bpmRef.current = b;
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
        onSave={() => onSave?.(measures, tempo, bpm, tsLabel)}
        saving={!!saving}
        saveMsg={saveMsg ?? null}
        onUndo={undo}
        onRedo={redo}
        beatSelCount={selCount}
        onSplitBeat={splitBeat}
        onMergeBeats={mergeBeats}
        onToggleRest={toggleRestForSel}
        onCancelBeatSel={() => setBeatSel(null)}
        hasPendingSel={!!pendingSel}
        hasChordToApply={!!chordToApply}
        chordToApplyName={chordToApply?.name}
        onCancelChord={() => { setPendingSel(null); onChordApplied?.(); }}
        tempo={tempo}
        onTempoChange={v => { setTempo(v); tempoRef.current = v; }}
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
                onChordClick={(name, posIdx, fromBeat) => { setActiveChord({ mi, fromBeat: fromBeat ?? 0 }); setPendingSel(null); onChordApplied?.(); onChordClick?.(name, posIdx); }}
                activeChord={activeChord?.mi === mi ? activeChord : null}
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
});
