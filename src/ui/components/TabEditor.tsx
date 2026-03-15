/**
 * TAB 编辑器 v6
 *
 * 核心: beat 带 weight (时值权重), 列宽按比例分配
 *   - 标准八分音符 weight=1, 列宽=BASE_W
 *   - 拆拍: 1拍(weight=1) → 2个半拍(weight=0.5), 总宽不变
 *   - 合拍: 相邻拍 weight 相加
 *   - 拍组用交替色块区分, 拆拍后子拍在同一色块内
 *
 * 选中拍: 拖选拍号标签 (mousedown→move→up)
 */
import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { resolveChord } from '../../core/chord/resolver';

// ---- 数据模型 ----

type StringMark =
  | { type: 'none' }
  | { type: 'chord' }
  | { type: 'custom'; fret: number };

type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];

export interface ChordRegion {
  fromBeat: number;
  toBeat: number;
  name: string;
}

interface TabBeat {
  strings: Strings6;
  /** 时值权重: 1=八分音符(默认), 0.5=十六分, 2=四分 */
  weight: number;
  /** 所属拍组 ID (同一拍组的 beat 用同一色块) */
  group: number;
  /** 是否标记为休止符 */
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
const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
const STRING_COUNT = 6;
const BASE_W = 36;
const MIN_W = 14;
const BARLINE_W = 2;
const LABEL_W = 28;
const TIME_SIGS: [string, number][] = [['3/4', 6], ['4/4', 8], ['6/8', 6]];

// ---- 工具 ----

function emptyStrings(): Strings6 {
  return [
    { type: 'none' }, { type: 'none' }, { type: 'none' },
    { type: 'none' }, { type: 'none' }, { type: 'none' },
  ];
}

function mkBeat(weight: number, group: number): TabBeat {
  return { strings: emptyStrings(), weight, group };
}

/** 创建小节: bpm 个八分音符, 每2个一组 */
function mkMeasure(bpm: number): TabMeasure {
  const beats: TabBeat[] = [];
  for (let i = 0; i < bpm; i++) {
    beats.push(mkBeat(1, Math.floor(i / 2)));
  }
  return { beats, chords: [] };
}

/** beat 的像素宽度 */
function beatWidth(b: TabBeat): number {
  return Math.max(MIN_W, Math.round(b.weight * BASE_W));
}

/** 小节总宽度 */
function measureWidth(m: TabMeasure): number {
  return m.beats.reduce((s, b) => s + beatWidth(b), 0) + BARLINE_W;
}

/** beat 的 x 偏移 */
function beatX(m: TabMeasure, bi: number): number {
  let x = 0;
  for (let i = 0; i < bi; i++) x += beatWidth(m.beats[i]);
  return x;
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

// ---- TMD 生成 ----

/** weight → AlphaTex 时值: 2→4, 1→8, 0.5→16, 0.25→32 */
function weightToDur(w: number): number {
  if (w >= 2) return 4;
  if (w >= 1) return 8;
  if (w >= 0.5) return 16;
  return 32;
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
  // 按 group 收集和弦
  const groups = new Map<number, string | null>();
  for (const b of m.beats) {
    if (!groups.has(b.group)) groups.set(b.group, null);
  }
  for (const c of m.chords) {
    if (c.fromBeat < m.beats.length) {
      groups.set(m.beats[c.fromBeat].group, c.name);
    }
  }
  const slots = [...groups.values()].map(v => v ?? '.');
  return `| ${slots.join(' ')} |`;
}

function genTmd(measures: TabMeasure[]): string {
  return measures
    .map((m, i) => hasContent(m) ? `${mToChordLine(m)}\ntex: ${mToTex(m, measures, i)}` : null)
    .filter(Boolean)
    .join('\n\n');
}

function splitRows(measures: TabMeasure[], cw: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let rowW = LABEL_W;
  for (let i = 0; i < measures.length; i++) {
    const mw = measureWidth(measures[i]);
    if (row.length > 0 && rowW + mw > cw) {
      rows.push(row);
      row = [i];
      rowW = LABEL_W + mw;
    } else {
      row.push(i);
      rowW += mw;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** 拍组标签: group 0→"1", group 1→"2", ... */
function groupLabel(group: number): string {
  return String(group + 1);
}

// ---- 主组件 ----

interface TabEditorProps {
  onTmdChange?: (tmd: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: string | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string) => void;
}

const STORAGE_KEY = 'tab-editor-state';

function loadSaved(): { bpm: number; tsLabel: string; measures: TabMeasure[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.measures) && obj.measures.length > 0) return obj;
  } catch { /* ignore */ }
  return null;
}

export function TabEditor({ onTmdChange, onChordSelectionStart, chordToApply, onChordApplied, onChordClick }: TabEditorProps) {
  const saved = useRef(loadSaved());
  const [bpm, setBpm] = useState(saved.current?.bpm ?? 8);
  const [tsLabel, setTsLabel] = useState(saved.current?.tsLabel ?? '4/4');
  const [measures, setMeasures] = useState<TabMeasure[]>(() =>
    saved.current?.measures ?? Array.from({ length: 4 }, () => mkMeasure(8))
  );

  // ---- Undo / Redo 历史栈 ----
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSnapshot = useRef<string>('');
  const MAX_UNDO = 50;

  /** 在修改前保存快照 */
  const pushUndo = useCallback((prev: TabMeasure[]) => {
    const snap = JSON.stringify(prev);
    if (snap === lastSnapshot.current) return; // 没变化不存
    undoStack.current.push(snap);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = []; // 新操作清空 redo
    lastSnapshot.current = snap;
  }, []);

  /** 带 undo 的 setMeasures */
  const updateMeasures = useCallback((updater: (prev: TabMeasure[]) => TabMeasure[]) => {
    setMeasures(prev => {
      const next = updater(prev);
      if (next !== prev) pushUndo(prev);
      return next;
    });
  }, [pushUndo]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const snap = undoStack.current.pop()!;
    // 当前状态存入 redo
    setMeasures(prev => {
      redoStack.current.push(JSON.stringify(prev));
      const restored = JSON.parse(snap) as TabMeasure[];
      lastSnapshot.current = snap;
      return restored;
    });
  }, []);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const snap = redoStack.current.pop()!;
    setMeasures(prev => {
      undoStack.current.push(JSON.stringify(prev));
      const restored = JSON.parse(snap) as TabMeasure[];
      lastSnapshot.current = snap;
      return restored;
    });
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // 和弦拖选
  const [dragState, setDragState] = useState<{
    mi: number; startBi: number; endBi: number;
  } | null>(null);
  const [pendingSel, setPendingSel] = useState<ChordSelectionPending | null>(null);

  // 弦线编辑 — 聚焦模式（无输入框）
  const [focusedCell, setFocusedCell] = useState<{ mi: number; bi: number; si: number } | null>(null);

  // 拍选中 (拖选拍号标签)
  const [beatSel, setBeatSel] = useState<{ mi: number; from: number; to: number } | null>(null);
  const [beatDrag, setBeatDrag] = useState<{ mi: number; start: number; end: number } | null>(null);

  const [containerW, setContainerW] = useState(900);
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 手动添加小节
  const addMeasure = useCallback(() => {
    updateMeasures(prev => [...prev, mkMeasure(bpm)]);
  }, [bpm, updateMeasures]);

  // 删除末尾空小节
  const removeLastMeasure = useCallback(() => {
    updateMeasures(prev => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, [updateMeasures]);

  // 侧边栏选了和弦 → 填入
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

  // 自动保存到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bpm, tsLabel, measures }));
    } catch { /* quota exceeded etc */ }
  }, [measures, bpm, tsLabel]);

  // ---- 和弦拖选 ----
  const handleChordMouseDown = useCallback((mi: number, bi: number) => {
    setDragState({ mi, startBi: bi, endBi: bi });
  }, []);
  const handleChordMouseEnter = useCallback((mi: number, bi: number) => {
    setDragState(prev => prev && prev.mi === mi ? { ...prev, endBi: bi } : prev);
  }, []);
  const handleChordMouseUp = useCallback(() => {
    if (!dragState) return;
    const { mi, startBi, endBi } = dragState;
    const from = Math.min(startBi, endBi);
    const to = Math.max(startBi, endBi) + 1;
    const sel: ChordSelectionPending = { measureIdx: mi, fromBeat: from, toBeat: to };
    setPendingSel(sel);
    onChordSelectionStart?.(sel);
    setDragState(null);
  }, [dragState, onChordSelectionStart]);

  useEffect(() => {
    const up = () => { if (dragState) handleChordMouseUp(); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [dragState, handleChordMouseUp]);

  const removeChordAt = useCallback((mi: number, bi: number) => {
    updateMeasures(prev => {
      const next = structuredClone(prev);
      next[mi].chords = next[mi].chords.filter(c => !(c.fromBeat <= bi && bi < c.toBeat));
      return next;
    });
  }, [updateMeasures]);

  // ---- 拍选中 (拖选拍号标签) ----
  const handleBeatDragStart = useCallback((mi: number, bi: number) => {
    setBeatDrag({ mi, start: bi, end: bi });
    setBeatSel(null);
  }, []);
  const handleBeatDragEnter = useCallback((mi: number, bi: number) => {
    setBeatDrag(prev => prev && prev.mi === mi ? { ...prev, end: bi } : prev);
  }, []);
  const handleBeatDragEnd = useCallback(() => {
    if (!beatDrag) return;
    const from = Math.min(beatDrag.start, beatDrag.end);
    const to = Math.max(beatDrag.start, beatDrag.end);
    setBeatSel({ mi: beatDrag.mi, from, to });
    setBeatDrag(null);
  }, [beatDrag]);

  useEffect(() => {
    const up = () => { if (beatDrag) handleBeatDragEnd(); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [beatDrag, handleBeatDragEnd]);

  // 选中范围 (合并 drag 和 sel)
  const getSelRange = (mi: number): [number, number] | null => {
    if (beatDrag && beatDrag.mi === mi) {
      return [Math.min(beatDrag.start, beatDrag.end), Math.max(beatDrag.start, beatDrag.end)];
    }
    if (beatSel && beatSel.mi === mi) return [beatSel.from, beatSel.to];
    return null;
  };
  const isBeatInSel = (mi: number, bi: number): boolean => {
    const r = getSelRange(mi);
    return r ? bi >= r[0] && bi <= r[1] : false;
  };

  // 选中拍数
  const selCount = beatSel ? beatSel.to - beatSel.from + 1 : 0;
  const selMi = beatSel?.mi ?? -1;

  // ---- 拆拍 ----
  const splitBeat = useCallback(() => {
    if (!beatSel) return;
    const { mi, from, to } = beatSel;
    updateMeasures(prev => {
      const next = structuredClone(prev);
      const m = next[mi];
      for (let bi = to; bi >= from; bi--) {
        const b = m.beats[bi];
        if (b.weight < 0.25) continue;
        const halfW = b.weight / 2;
        const g = b.group;
        b.weight = halfW;
        m.beats.splice(bi + 1, 0, mkBeat(halfW, g));
        for (const c of m.chords) {
          if (c.fromBeat > bi) c.fromBeat++;
          if (c.toBeat > bi) c.toBeat++;
        }
      }
      return next;
    });
    setBeatSel(null);
  }, [beatSel, updateMeasures]);

  // ---- 合拍 ----
  const mergeBeats = useCallback(() => {
    if (!beatSel || selCount < 2) return;
    const { mi, from, to } = beatSel;
    updateMeasures(prev => {
      const next = structuredClone(prev);
      const m = next[mi];
      let totalW = 0;
      for (let i = from; i <= to; i++) totalW += m.beats[i].weight;
      const keepBeat = m.beats[from];
      if (keepBeat.strings.every(s => s.type === 'none')) {
        for (let i = from + 1; i <= to; i++) {
          if (m.beats[i].strings.some(s => s.type !== 'none')) {
            keepBeat.strings = m.beats[i].strings;
            break;
          }
        }
      }
      keepBeat.weight = totalW;
      const removeCount = to - from;
      m.beats.splice(from + 1, removeCount);
      for (const c of m.chords) {
        if (c.fromBeat > from) c.fromBeat = Math.max(from, c.fromBeat - removeCount);
        if (c.toBeat > from + 1) c.toBeat = Math.max(from + 1, c.toBeat - removeCount);
      }
      m.chords = m.chords.filter(c => c.toBeat > c.fromBeat);
      return next;
    });
    setBeatSel(null);
  }, [beatSel, selCount, updateMeasures]);

  // ---- 弦线交互 ----
  const handleStringClick = useCallback((mi: number, bi: number, si: number) => {
    const ch = chordAt(measures, mi, bi);
    const cur = measures[mi]?.beats[bi]?.strings[si];
    if (!cur) return;

    if (cur.type === 'none') {
      // 空格 → 有和弦标 ×，无和弦也标 custom 0 先占位？不，直接聚焦等输入
      if (ch) {
        updateMeasures(prev => {
          const next = structuredClone(prev);
          next[mi].beats[bi].strings[si] = { type: 'chord' };
          return next;
        });
      }
    }
    // 聚焦该格，等待键盘输入
    setFocusedCell({ mi, bi, si });
  }, [measures, updateMeasures]);

  // 全局键盘监听：聚焦弦格时按数字写入品位，backspace/delete 清除
  useEffect(() => {
    if (!focusedCell) return;
    const handler = (e: KeyboardEvent) => {
      const { mi, bi, si } = focusedCell;
      if (e.key === 'Escape') {
        setFocusedCell(null);
        return;
      }
      // r 键 → 切换整拍休止符
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        updateMeasures(prev => {
          const next = structuredClone(prev);
          const beat = next[mi].beats[bi];
          beat.rest = !beat.rest;
          if (beat.rest) {
            // 标记休止时清空所有弦
            beat.strings = emptyStrings();
          }
          return next;
        });
        setFocusedCell(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        updateMeasures(prev => {
          const next = structuredClone(prev);
          next[mi].beats[bi].strings[si] = { type: 'none' };
          return next;
        });
        setFocusedCell(null);
        return;
      }
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 0 && num <= 9) {
        e.preventDefault();
        updateMeasures(prev => {
          const next = structuredClone(prev);
          // 如果当前已有数字，尝试拼两位（如 1→12）
          const cur = prev[mi].beats[bi].strings[si];
          let fret = num;
          if (cur.type === 'custom' && cur.fret < 10) {
            const twoDigit = cur.fret * 10 + num;
            if (twoDigit <= 24) fret = twoDigit;
          }
          next[mi].beats[bi].strings[si] = { type: 'custom', fret };
          return next;
        });
        // 不立即取消聚焦，允许连续输入第二位
        return;
      }
      // 其他键不处理
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedCell, updateMeasures]);

  const handleTsChange = useCallback((label: string, b: number) => {
    setTsLabel(label); setBpm(b);
    setMeasures([mkMeasure(b)]);
    setBeatSel(null);
  }, []);

  const copyTmd = useCallback(() => {
    navigator.clipboard.writeText(tmdText).catch(() => {});
  }, [tmdText]);

  const cellDisplay = (mi: number, bi: number, si: number): string => {
    const mk = measures[mi]?.beats[bi]?.strings[si];
    if (!mk || mk.type === 'none') return '';
    return mk.type === 'chord' ? '×' : String(mk.fret);
  };

  /** 是否标记为休止符 */
  const isBeatRest = (mi: number, bi: number): boolean => {
    return !!measures[mi]?.beats[bi]?.rest;
  };

  // 拖选高亮
  const isDragHighlight = (mi: number, bi: number): boolean => {
    if (!dragState || dragState.mi !== mi) return false;
    const from = Math.min(dragState.startBi, dragState.endBi);
    const to = Math.max(dragState.startBi, dragState.endBi);
    return bi >= from && bi <= to;
  };
  const isPendingHighlight = (mi: number, bi: number): boolean => {
    if (!pendingSel || pendingSel.measureIdx !== mi) return false;
    return bi >= pendingSel.fromBeat && bi < pendingSel.toBeat;
  };

  // beat 状态分类
  type BeatKind = 'normal' | 'split' | 'merged';
  const beatKind = (b: TabBeat): BeatKind => {
    if (b.weight < 1) return 'split';
    if (b.weight > 1) return 'merged';
    return 'normal';
  };

  // 拍组色块 + beat 状态色
  const beatBg = (b: TabBeat, selected: boolean): string => {
    if (selected) return 'var(--beat-sel-bg, rgba(59,130,246,0.22))';
    const kind = beatKind(b);
    if (kind === 'split') {
      // 拆拍: 更深的底色，紫色调
      return b.group % 2 === 0
        ? 'rgba(139, 92, 246, 0.12)'   // 紫色A
        : 'rgba(139, 92, 246, 0.08)';  // 紫色B
    }
    if (kind === 'merged') {
      // 合拍: 绿色调
      return b.group % 2 === 0
        ? 'rgba(16, 185, 129, 0.12)'   // 绿色A
        : 'rgba(16, 185, 129, 0.08)';  // 绿色B
    }
    // 标准拍
    return b.group % 2 === 0
      ? 'var(--beat-group-a, rgba(59,130,246,0.06))'
      : 'var(--beat-group-b, rgba(245,158,11,0.06))';
  };

  // beat 左边框样式
  const beatBorderLeft = (b: TabBeat, bi: number, m: TabMeasure): string => {
    const isGroupStart = bi === 0 || m.beats[bi - 1].group !== b.group;
    const kind = beatKind(b);
    if (isGroupStart) {
      if (kind === 'merged') return '3px solid rgba(16, 185, 129, 0.5)';
      return '2px solid var(--beat-group-border, rgba(0,0,0,0.12))';
    }
    if (kind === 'split') return '1px dashed rgba(139, 92, 246, 0.3)';
    return 'none';
  };

  // 拍号标签内容
  const beatLabelContent = (b: TabBeat, bi: number, m: TabMeasure): string => {
    const isGroupStart = bi === 0 || m.beats[bi - 1].group !== b.group;
    const kind = beatKind(b);
    if (kind === 'merged') {
      // 合拍: 显示时值符号
      if (b.weight >= 4) return '𝅝';  // 全音符
      if (b.weight >= 2) return '♩';  // 四分音符
      return isGroupStart ? groupLabel(b.group) : '';
    }
    if (kind === 'split') {
      // 拆拍: 组内第一个显示组号，其余显示 ·
      return isGroupStart ? groupLabel(b.group) : '·';
    }
    return isGroupStart ? groupLabel(b.group) : '';
  };

  // ---- 渲染 ----
  return (
    <div className="tab-editor-v2">
      {/* 工具栏 */}
      <div className="tab-toolbar">
        <span className="tab-toolbar-title">TAB 编辑器</span>
        <div className="tab-toolbar-actions">
          <button className="tab-action-btn tab-undo-btn" onClick={undo} title="撤销 (Ctrl+Z)">↩</button>
          <button className="tab-action-btn tab-redo-btn" onClick={redo} title="重做 (Ctrl+Shift+Z)">↪</button>
          <span className="tab-toolbar-divider">|</span>
          {pendingSel && <span className="tab-toolbar-hint">← 从和弦库选择和弦</span>}
          {beatSel && (
            <>
              <span className="tab-toolbar-info">
                已选 {selCount} 拍 · 小节{selMi + 1}
              </span>
              <button className="tab-action-btn" onClick={splitBeat}>拆拍</button>
              <button className="tab-action-btn" disabled={selCount < 2} onClick={mergeBeats}>合拍</button>
              <button className="tab-action-btn" onClick={() => {
                if (!beatSel) return;
                const { mi, from, to } = beatSel;
                updateMeasures(prev => {
                  const next = structuredClone(prev);
                  for (let bi = from; bi <= to; bi++) {
                    const beat = next[mi].beats[bi];
                    beat.rest = !beat.rest;
                    if (beat.rest) beat.strings = emptyStrings();
                  }
                  return next;
                });
                setBeatSel(null);
              }}>休止</button>
              <button className="tab-action-btn" onClick={() => setBeatSel(null)}>取消</button>
              <span className="tab-toolbar-divider">|</span>
            </>
          )}
          <select className="tab-timesig-select" value={tsLabel}
            onChange={e => {
              const o = TIME_SIGS.find(t => t[0] === e.target.value);
              if (o) handleTsChange(o[0], o[1]);
            }}>
            {TIME_SIGS.map(([l]) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="tab-toolbar-divider">|</span>
          <button className="tab-action-btn" onClick={addMeasure} title="添加小节">+ 小节</button>
          <button className="tab-action-btn" onClick={removeLastMeasure} title="删除末尾小节" disabled={measures.length <= 1}>− 小节</button>
          <span className="tab-toolbar-count">{measures.length} 小节</span>
          <button className="tab-copy-btn" onClick={copyTmd}>复制 TMD</button>
        </div>
      </div>

      {/* 谱面 */}
      <div className="tab-grid-scroll" ref={gridRef}>
        {rows.map((rowMis, ri) => (
          <div key={ri} className="tab-row">
            {/* 弦名标签 */}
            <div className="tab-string-labels">
              <div className="tab-label-num-row" />
              <div className="tab-label-beat-row" />
              <div className="tab-label-chord-row" />
              {STRING_NAMES.map((n, si) => (
                <div key={si} className="tab-string-name">{n}</div>
              ))}
            </div>

            {rowMis.map(mi => {
              const m = measures[mi];
              return (
                <div key={mi} className="tab-measure-wrap">
                  <div className="tab-measure-num">{mi + 1}</div>
                  <div className="tab-measure-body">

                    {/* 拍号标签行 — 拖选选中拍 */}
                    <div className="tab-beat-labels-row">
                      {m.beats.map((b, bi) => {
                        const w = beatWidth(b);
                        const sel = isBeatInSel(mi, bi);
                        const kind = beatKind(b);
                        const isGroupStart = bi === 0 || m.beats[bi - 1].group !== b.group;
                        const isGroupEnd = bi === m.beats.length - 1 || m.beats[bi + 1].group !== b.group;
                        const groupHasMultiple = !isGroupStart || !isGroupEnd;
                        return (
                          <div key={bi}
                            className={`tab-beat-label tab-beat-label-clickable ${sel ? 'selected' : ''} ${kind !== 'normal' ? 'tab-beat-' + kind : ''}`}
                            style={{
                              width: w,
                              background: beatBg(b, sel),
                              borderLeft: beatBorderLeft(b, bi, m),
                            }}
                            onMouseDown={e => { e.preventDefault(); handleBeatDragStart(mi, bi); }}
                            onMouseEnter={() => handleBeatDragEnter(mi, bi)}
                          >
                            {/* 拆拍顶部连接括号 */}
                            {kind === 'split' && groupHasMultiple && (
                              <span className="tab-split-bracket"
                                style={{
                                  borderLeft: isGroupStart ? '2px solid rgba(139,92,246,0.5)' : 'none',
                                  borderRight: isGroupEnd ? '2px solid rgba(139,92,246,0.5)' : 'none',
                                  borderTop: '2px solid rgba(139,92,246,0.5)',
                                }}
                              />
                            )}
                            {/* 合拍底部粗线 */}
                            {kind === 'merged' && (
                              <span className="tab-merge-bar" />
                            )}
                            <span className="tab-beat-label-text">{beatLabelContent(b, bi, m)}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* 和弦区间行 */}
                    <div className="tab-chord-row" style={{ width: m.beats.reduce((s, b) => s + beatWidth(b), 0) }}>
                      {m.chords.map((c, ci) => (
                        <div key={ci} className="tab-chord-region"
                          style={{ left: beatX(m, c.fromBeat), width: beatX(m, c.toBeat) - beatX(m, c.fromBeat) }}
                          onClick={e => { e.stopPropagation(); setPendingSel(null); onChordClick?.(c.name); }}
                          onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                          onContextMenu={e => { e.preventDefault(); removeChordAt(mi, c.fromBeat); }}
                        >
                          <span className="tab-chord-region-name">{c.name}</span>
                        </div>
                      ))}
                      {m.beats.map((b, bi) => (
                        <div key={bi}
                          className={`tab-chord-drag-cell ${isDragHighlight(mi, bi) ? 'dragging' : ''} ${isPendingHighlight(mi, bi) ? 'pending' : ''}`}
                          style={{ left: beatX(m, bi), width: beatWidth(b) }}
                          onMouseDown={e => { e.preventDefault(); handleChordMouseDown(mi, bi); }}
                          onMouseEnter={() => handleChordMouseEnter(mi, bi)}
                        />
                      ))}
                    </div>

                    {/* 弦线区 */}
                    <div className="tab-strings-area">
                      {m.beats.map((b, bi) => {
                        const w = beatWidth(b);
                        const sel = isBeatInSel(mi, bi);
                        return (
                          <div key={bi}
                            className={`tab-beat-col ${beatKind(b) !== 'normal' ? 'tab-col-' + beatKind(b) : ''}`}
                            style={{
                              width: w,
                              background: beatBg(b, sel),
                              borderLeft: beatBorderLeft(b, bi, m),
                            }}
                          >
                            {/* 休止符标记 — 整拍全空时显示 */}
                            {isBeatRest(mi, bi) && (
                              <div className="tab-rest-indicator" title="休止符（整拍不弹）">
                                <svg width="10" height="20" viewBox="0 0 10 20">
                                  <path d="M7 2 L3 8 L7 8 L2 14 M4 14 Q6 14 6 16 Q6 19 3 19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </div>
                            )}
                            {Array.from({ length: STRING_COUNT }, (__, si) => {
                              const d = cellDisplay(mi, bi, si);
                              const isFocused = focusedCell?.mi === mi && focusedCell?.bi === bi && focusedCell?.si === si;
                              return (
                                <div key={si}
                                  className={`tab-string-cell ${d === '×' ? 'tab-cell-chord' : d ? 'tab-cell-custom' : ''} ${isFocused ? 'tab-cell-focused' : ''}`}
                                  title={`${si + 1}弦 (${STRING_NAMES[si]})`}
                                  onClick={() => handleStringClick(mi, bi, si)}>
                                  <div className="tab-string-line" />
                                  {d ? (
                                    <span className={`tab-fret-display ${d === '×' ? 'is-x' : 'is-num'}`}>{d}</span>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      <div className="tab-barline" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="tab-hint">
        拖选拍号 → 拆拍/合拍 · 拖选和弦区 → 侧边栏填入 · 右键删和弦 · 单击弦线: 标记/聚焦 → 按数字键入品位 · Backspace 清除 · Esc 取消 · Ctrl+Z 撤销
      </div>

      {tmdText.trim() && (
        <div className="tab-tmd-output">
          <pre className="tab-tmd-text">{tmdText}</pre>
        </div>
      )}
    </div>
  );
}
