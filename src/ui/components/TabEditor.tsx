/**
 * TAB 编辑器 v8 — 重构版
 *
 * 职责：六线谱网格编辑，段落管理由 TabWorkspace 处理。
 * 子组件：TabToolbar（工具栏）、TabMeasureView（小节渲染）
 *
 * 类型/常量/工具函数 → tab/tab-types.ts
 * TMD 生成 → tab/tab-tmd-gen.ts
 */
import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { RhythmPattern } from '../../core/types';
import { parseTmdToMeasures } from '../../core/tmd-to-measures';
import { TabToolbar } from './tab/TabToolbar';
import { TabMeasureView } from './tab/TabMeasureView';

// 从拆分模块重新导出类型（保持外部 import 兼容）
export type { StringMark, Strings6, ChordRegion, TabBeat, TabMeasure, ChordSelectionPending } from './tab/tab-types';
export { mkMeasure, emptyStrings } from './tab/tab-types';
export { genSectionBody, genChordDefs, genTmdHeader, genRhythmDefs } from './tab/tab-tmd-gen';

import {
  STRING_NAMES, TIME_SIGS,
  emptyStrings, mkBeat, mkMeasure,
} from './tab/tab-types';
import type { TabMeasure, TabBeat, ChordSelectionPending } from './tab/tab-types';
import { chordAt, genTmd, splitRows } from './tab/tab-tmd-gen';

// ---- 模块级剪贴板（跨段落切换不丢失） ----
let moduleClipboard: TabMeasure[] = [];

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
  onMeasuresChange?: (measures: TabMeasure[], segmentName: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: { name: string; positionIndex: number } | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string, positionIndex?: number) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  onRhythmSelectionStart?: () => void;
  rhythmMap?: Map<string, RhythmPattern>;
}

export interface TabEditorHandle {
  triggerSave: () => void;
  updateChordPosition: (chordName: string, positionIndex: number) => void;
  applyRhythm: (rhythm: RhythmPattern) => void;
}


export const TabEditor = forwardRef<TabEditorHandle, TabEditorProps>(function TabEditor({
  initialMeasures, initialTempo = 72, initialBpm = 8, initialTsLabel = '4/4',
  segmentName = '', onSegmentNameChange,
  onSave, saving, saveMsg,
  onTmdChange, onMeasuresChange, onChordSelectionStart, chordToApply, onChordApplied, onChordClick,
  previewOpen, onTogglePreview, onRhythmSelectionStart, rhythmMap,
}: TabEditorProps, ref) {
  const [tempo, setTempo] = useState(initialTempo);
  const [bpm, setBpm] = useState(initialBpm);
  const [tsLabel, setTsLabel] = useState(initialTsLabel);
  const [measures, setMeasures] = useState<TabMeasure[]>(() =>
    initialMeasures ?? Array.from({ length: 4 }, () => mkMeasure(initialBpm))
  );

  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  const tempoRef = useRef(initialTempo);
  const bpmRef = useRef(initialBpm);
  const tsLabelRef = useRef(initialTsLabel);

  // ---- Undo / Redo ----
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSnapshot = useRef('');
  const rhythmSeqCounter = useRef(0);

  // 底部节奏型拖选
  const [rhythmSel, setRhythmSel] = useState<{ mi: number; from: number; to: number } | null>(null);
  const rhythmSelRef = useRef(rhythmSel);
  rhythmSelRef.current = rhythmSel;

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
      const sel = rhythmSelRef.current;
      if (!sel) return;

      const { mi: targetMi, from: selFrom, to: selTo } = sel;
      const seq = ++rhythmSeqCounter.current;
      const slotCount = rhythm.slots.length;

      setMeasures(prev => {
        const snap = JSON.stringify(prev);
        undoStack.current.push(snap);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
        lastSnapshot.current = snap;

        return prev.map((m, mi) => {
          if (mi !== targetMi) return m;
          const next = structuredClone(m);
          const oldBeats = next.beats.splice(selFrom, selTo - selFrom + 1);
          const totalWeight = oldBeats.reduce((s, b) => s + b.weight, 0);
          const newWeight = totalWeight / slotCount;

          // group 分配：收集选中区域内的 group 边界，按比例映射
          // 简单方式：每个原始 beat 占 totalWeight 中的一份，
          // 新 beat 按时间位置落入对应原始 beat 的 group
          const groupMap: { cumWeight: number; group: number }[] = [];
          let cum = 0;
          for (const ob of oldBeats) {
            groupMap.push({ cumWeight: cum, group: ob.group });
            cum += ob.weight;
          }

          const newBeats: TabBeat[] = [];
          for (let i = 0; i < slotCount; i++) {
            const pos = i * newWeight;
            // 找到 pos 落入哪个原始 beat 的区间
            let g = groupMap[0].group;
            for (let j = groupMap.length - 1; j >= 0; j--) {
              if (pos >= groupMap[j].cumWeight - 0.001) { g = groupMap[j].group; break; }
            }
            newBeats.push({
              strings: emptyStrings(),
              weight: newWeight,
              group: g,
              rhythmId: rhythm.id,
              rhythmSeq: seq,
            });
          }

          next.beats.splice(selFrom, 0, ...newBeats);

          // 调整和弦区域的 fromBeat/toBeat 索引
          const delta = slotCount - oldBeats.length;
          for (const c of next.chords) {
            if (c.fromBeat > selTo) {
              c.fromBeat += delta;
              c.toBeat += delta;
            } else if (c.fromBeat >= selFrom) {
              // 和弦在选中区域内：按比例缩放
              const ratio = slotCount / oldBeats.length;
              c.fromBeat = selFrom + Math.round((c.fromBeat - selFrom) * ratio);
              c.toBeat = selFrom + Math.round((c.toBeat - selFrom) * ratio);
            }
          }

          return next;
        });
      });
      setRhythmSel(null);
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

  // ---- 交互状态 ----
  const [dragState, setDragState] = useState<{ mi: number; startBi: number; endBi: number } | null>(null);
  const [pendingSel, setPendingSel] = useState<ChordSelectionPending | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ mi: number; bi: number; si: number } | null>(null);
  const [beatSel, setBeatSel] = useState<{ mi: number; from: number; to: number } | null>(null);
  const [beatDrag, setBeatDrag] = useState<{ mi: number; start: number; end: number } | null>(null);
  const [rhythmDrag, setRhythmDrag] = useState<{ mi: number; start: number; end: number } | null>(null);
  const [activeChord, setActiveChord] = useState<{ mi: number; fromBeat: number } | null>(null);
  const [measureSel, setMeasureSel] = useState<{ from: number; to: number } | null>(null);
  const [containerW, setContainerW] = useState(900);
  const gridRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);

  const containerWRef = useRef(900);
  const rafRef = useRef(0);
  useLayoutEffect(() => {
    const el = gridRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (Math.abs(w - containerWRef.current) < 4) return;
        containerWRef.current = w;
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setContainerW(w));
      }
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, []);

  // 和弦填入：chordToApply + pendingSel 同时存在时填入
  // 或者 chordToApply + activeChord 存在时替换已选中和弦
  useEffect(() => {
    if (!chordToApply) return;

    // 优先：替换已选中的和弦
    if (activeChord) {
      const { mi, fromBeat } = activeChord;
      updateMeasures(prev => {
        const next = structuredClone(prev);
        const chord = next[mi].chords.find(c => c.fromBeat === fromBeat);
        if (chord) {
          chord.name = chordToApply.name;
          chord.positionIndex = chordToApply.positionIndex;
        }
        return next;
      });
      setActiveChord(null);
      onChordApplied?.();
      return;
    }

    // 其次：拖选区域填入新和弦
    if (pendingSel) {
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
  }, [chordToApply, pendingSel, activeChord, onChordApplied, updateMeasures]);

  // Escape 取消 pendingSel 和 chordToApply；Backspace 删除选中和弦
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (measureSel) { setMeasureSel(null); }
        if (activeChord) { setActiveChord(null); }
        if (pendingSel) { setPendingSel(null); }
        if (chordToApply) { onChordApplied?.(); }
      }
      if (e.key === 'Backspace' && activeChord) {
        e.preventDefault();
        const { mi, fromBeat } = activeChord;
        updateMeasures(prev => {
          const next = structuredClone(prev);
          next[mi].chords = next[mi].chords.filter(c => c.fromBeat !== fromBeat);
          return next;
        });
        setActiveChord(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingSel, chordToApply, onChordApplied, activeChord, measureSel, updateMeasures]);

  const rows = useMemo(() => splitRows(measures, containerW), [measures, containerW]);
  const tmdText = useMemo(() => genTmd(measures, { bpm: tempo, tsLabel, sectionName: segmentName, rhythmMap }), [measures, tempo, tsLabel, segmentName, rhythmMap]);
  useEffect(() => { onTmdChange?.(tmdText); }, [tmdText, onTmdChange]);
  useEffect(() => { onMeasuresChange?.(measures, segmentName); }, [measures, segmentName, onMeasuresChange]);

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
  const handleChordMouseDown = useCallback((mi: number, bi: number) => { setDragState({ mi, startBi: bi, endBi: bi }); setMeasureSel(null); }, []);
  const handleChordMouseEnter = useCallback((mi: number, bi: number) => setDragState(prev => prev && prev.mi === mi ? { ...prev, endBi: bi } : prev), []);
  const handleChordMouseUp = useCallback(() => {
    if (!dragState) return;
    const from = Math.min(dragState.startBi, dragState.endBi);
    const to = Math.max(dragState.startBi, dragState.endBi) + 1;
    const sel: ChordSelectionPending = { measureIdx: dragState.mi, fromBeat: from, toBeat: to };
    setPendingSel(sel); onChordSelectionStart?.(sel); setDragState(null);
  }, [dragState, onChordSelectionStart]);
  useEffect(() => { const up = () => { if (dragState) handleChordMouseUp(); }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, [dragState, handleChordMouseUp]);

  // ---- 拍选中 ----
  const handleBeatDragStart = useCallback((mi: number, bi: number) => { setBeatDrag({ mi, start: bi, end: bi }); setBeatSel(null); setMeasureSel(null); }, []);
  const handleBeatDragEnter = useCallback((mi: number, bi: number) => setBeatDrag(prev => prev && prev.mi === mi ? { ...prev, end: bi } : prev), []);
  const handleBeatDragEnd = useCallback(() => {
    if (!beatDrag) return;
    setBeatSel({ mi: beatDrag.mi, from: Math.min(beatDrag.start, beatDrag.end), to: Math.max(beatDrag.start, beatDrag.end) });
    setBeatDrag(null);
  }, [beatDrag]);
  useEffect(() => { const up = () => { if (beatDrag) handleBeatDragEnd(); }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, [beatDrag, handleBeatDragEnd]);

  // ---- 底部节奏型拖选 ----
  const handleRhythmDragStart = useCallback((mi: number, bi: number) => { setRhythmDrag({ mi, start: bi, end: bi }); setRhythmSel(null); setMeasureSel(null); }, []);
  const handleRhythmDragEnter = useCallback((mi: number, bi: number) => setRhythmDrag(prev => prev && prev.mi === mi ? { ...prev, end: bi } : prev), []);
  const handleRhythmDragEnd = useCallback(() => {
    if (!rhythmDrag) return;
    setRhythmSel({ mi: rhythmDrag.mi, from: Math.min(rhythmDrag.start, rhythmDrag.end), to: Math.max(rhythmDrag.start, rhythmDrag.end) });
    setRhythmDrag(null);
    onRhythmSelectionStart?.();
  }, [rhythmDrag, onRhythmSelectionStart]);
  useEffect(() => { const up = () => { if (rhythmDrag) handleRhythmDragEnd(); }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, [rhythmDrag, handleRhythmDragEnd]);

  const isRhythmInSel = (mi: number, bi: number): boolean => {
    if (rhythmDrag && rhythmDrag.mi === mi) { const [a, b] = [Math.min(rhythmDrag.start, rhythmDrag.end), Math.max(rhythmDrag.start, rhythmDrag.end)]; return bi >= a && bi <= b; }
    if (rhythmSel && rhythmSel.mi === mi) return bi >= rhythmSel.from && bi <= rhythmSel.to;
    return false;
  };
  const rhythmSelCount = rhythmSel ? rhythmSel.to - rhythmSel.from + 1 : 0;

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

  // ---- 小节操作：选中 / 插入 / 复制 / 粘贴 ----

  const handleMeasureClick = useCallback((mi: number, shiftKey: boolean, metaKey: boolean) => {
    if (shiftKey && measureSel) {
      // Shift：连续选区
      setMeasureSel({ from: Math.min(measureSel.from, mi), to: Math.max(measureSel.to, mi) });
    } else if (metaKey && measureSel) {
      // Ctrl/Cmd：toggle 单个小节，合并到已有选区
      if (mi >= measureSel.from && mi <= measureSel.to) {
        // 取消选中：如果只选了一个就清空，否则收缩边界
        if (measureSel.from === measureSel.to) { setMeasureSel(null); }
        else if (mi === measureSel.from) { setMeasureSel({ from: measureSel.from + 1, to: measureSel.to }); }
        else if (mi === measureSel.to) { setMeasureSel({ from: measureSel.from, to: measureSel.to - 1 }); }
        // 中间的不处理（连续选区模型，不支持断开）
      } else {
        // 扩展选区到包含该小节
        setMeasureSel({ from: Math.min(measureSel.from, mi), to: Math.max(measureSel.to, mi) });
      }
    } else if (metaKey) {
      // Ctrl/Cmd 无已有选区：开始新选区
      setMeasureSel({ from: mi, to: mi });
    } else {
      setMeasureSel({ from: mi, to: mi });
    }
  }, [measureSel]);

  const insertMeasure = useCallback((at: number, before: boolean) => {
    const idx = before ? at : at + 1;
    updateMeasures(prev => [...prev.slice(0, idx), mkMeasure(bpm), ...prev.slice(idx)]);
    setMeasureSel(null);
  }, [bpm, updateMeasures]);

  const copySelectedMeasures = useCallback(() => {
    if (!measureSel) return;
    moduleClipboard = structuredClone(measures.slice(measureSel.from, measureSel.to + 1));
  }, [measureSel, measures]);

  const pasteAfter = useCallback((mi: number) => {
    if (moduleClipboard.length === 0) return;
    const copied = structuredClone(moduleClipboard);
    updateMeasures(prev => [...prev.slice(0, mi + 1), ...copied, ...prev.slice(mi + 1)]);
    setMeasureSel(null);
  }, [updateMeasures]);

  const deleteSelectedMeasures = useCallback(() => {
    if (!measureSel) return;
    updateMeasures(prev => {
      if (prev.length <= 1) return prev;
      const next = [...prev.slice(0, measureSel.from), ...prev.slice(measureSel.to + 1)];
      return next.length > 0 ? next : [mkMeasure(bpm)];
    });
    setMeasureSel(null);
  }, [measureSel, bpm, updateMeasures]);

  const measureSelCount = measureSel ? measureSel.to - measureSel.from + 1 : 0;

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 1200);
  }, []);

  // ---- 全局快捷键：Undo/Redo + Copy/Paste ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
      // Ctrl/Cmd+C：复制选中小节
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && measureSel) {
        e.preventDefault(); copySelectedMeasures();
        showToast(`已复制 ${measureSel.to - measureSel.from + 1} 个小节`);
      }
      // Ctrl/Cmd+V：粘贴到选中小节后面，无选中则追加到末尾
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && moduleClipboard.length > 0) {
        e.preventDefault();
        pasteAfter(measureSel ? measureSel.to : measuresRef.current.length - 1);
        showToast(`已粘贴 ${moduleClipboard.length} 个小节`);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, measureSel, copySelectedMeasures, pasteAfter, showToast]);

  // ---- 弦线交互 ----
  const handleStringClick = useCallback((mi: number, bi: number, si: number) => {
    setMeasureSel(null);
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
    <div className="tab-editor-v2" onContextMenu={e => e.preventDefault()}>
      <TabToolbar
        segmentName={segmentName}
        onSegmentNameChange={n => onSegmentNameChange?.(n)}
        onSave={() => onSave?.(measures, tempo, bpm, tsLabel)}
        saving={!!saving}
        saveMsg={saveMsg ?? null}
        onUndo={undo}
        onRedo={redo}
        beatSelCount={selCount}
        beatSelMi={beatSel?.mi ?? null}
        onSplitBeat={splitBeat}
        onMergeBeats={mergeBeats}
        onToggleRest={toggleRestForSel}
        onCancelBeatSel={() => setBeatSel(null)}
        rhythmSelCount={rhythmSelCount}
        onCancelRhythmSel={() => setRhythmSel(null)}
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
        measureSelCount={measureSelCount}
        onCopyMeasures={copySelectedMeasures}
        onDeleteMeasures={deleteSelectedMeasures}
        onCancelMeasureSel={() => setMeasureSel(null)}
        hasClipboard={moduleClipboard.length > 0}
        onPasteAfter={() => { if (measureSel) pasteAfter(measureSel.to); }}
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
              <div className="tab-label-rhythm-row">♩</div>
            </div>
            {rowMis.map(mi => (
              <TabMeasureView
                key={mi}
                measure={measures[mi]}
                mi={mi}
                isBeatSelected={bi => isBeatInSel(mi, bi)}
                onBeatDragStart={bi => handleBeatDragStart(mi, bi)}
                onBeatDragEnter={bi => handleBeatDragEnter(mi, bi)}
                isRhythmSelected={bi => isRhythmInSel(mi, bi)}
                onRhythmDragStart={bi => handleRhythmDragStart(mi, bi)}
                onRhythmDragEnter={bi => handleRhythmDragEnter(mi, bi)}
                isDragHL={bi => isDragHL(mi, bi)}
                isPendingHL={bi => isPendingHL(mi, bi)}
                onChordMouseDown={bi => handleChordMouseDown(mi, bi)}
                onChordMouseEnter={bi => handleChordMouseEnter(mi, bi)}
                onChordClick={(name, posIdx, fromBeat) => { setActiveChord({ mi, fromBeat: fromBeat ?? 0 }); setPendingSel(null); onChordApplied?.(); onChordClick?.(name, posIdx); }}
                activeChord={activeChord?.mi === mi ? activeChord : null}
                onPendingSelClear={() => setPendingSel(null)}
                focusedCell={focusedCell}
                onStringClick={(bi, si) => handleStringClick(mi, bi, si)}
                cellDisplay={(bi, si) => cellDisplay(mi, bi, si)}
                onInsertMeasureBefore={() => insertMeasure(measureSel?.from ?? mi, true)}
                onInsertMeasureAfter={() => insertMeasure(measureSel?.to ?? mi, false)}
                onCopyMeasures={copySelectedMeasures}
                onPasteAfter={() => pasteAfter(measureSel?.to ?? mi)}
                onDeleteMeasures={deleteSelectedMeasures}
                isMeasureSelected={!!measureSel && mi >= measureSel.from && mi <= measureSel.to}
                onMeasureClick={(shiftKey, metaKey) => handleMeasureClick(mi, shiftKey, metaKey)}
                hasClipboard={moduleClipboard.length > 0}
                measureSelCount={measureSelCount}
                measureCount={measures.length}
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

      {toast && <div className="tab-toast">{toast}</div>}
    </div>
  );
});
