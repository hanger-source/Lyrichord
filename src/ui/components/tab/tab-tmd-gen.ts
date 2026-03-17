/**
 * TMD 生成：TabMeasure[] → TMD 文本
 *
 * 包含 mToTex、genSectionBody、genChordDefs、genTmdHeader 等导出函数，
 * 以及 chordAt、splitRows 等内部辅助。
 */
import { resolveChord } from '../../../core/chord/resolver';
import { measureWidth } from './TabMeasureView';
import type { TabMeasure, ChordRegion } from './tab-types';
import { STRING_COUNT, LABEL_W } from './tab-types';

import type { RhythmPattern } from '../../../core/types';

// ---- 内部辅助 ----

export function chordAt(measures: TabMeasure[], mi: number, bi: number): ChordRegion | null {
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

export function chordFretForString(name: string, si: number, positionIndex?: number): number {
  const def = resolveChord(name);
  if (!def) return 0;
  const idx = positionIndex ?? 0;
  const pos = def.positions?.[idx];
  if (pos) {
    const relFret = pos.frets[5 - si];
    if (relFret <= 0) return relFret;
    return relFret + pos.baseFret - 1;
  }
  return def.frets[5 - si];
}

function hasContent(m: TabMeasure): boolean {
  if (m.chords.length > 0) return true;
  return m.beats.some(b => b.rest || b.strings.some(s => s.type !== 'none'));
}

function weightToDur(w: number): string {
  // TAB 编辑器里 weight 的含义:
  //   4/4 拍 8 拍小节: 每拍 weight=1 = 八分音符
  //   weight=2 = 四分, weight=4 = 二分, weight=8 = 全音符
  // 支持附点: 1.5 → 附点八分 "8{d}", 3 → 附点四分 "4{d}"
  if (w >= 8) return '1';                          // 全音符
  if (Math.abs(w - 6) < 0.01) return '2{d}';       // 附点二分
  if (w >= 4) return '2';                           // 二分音符
  if (Math.abs(w - 3) < 0.01) return '4{d}';       // 附点四分
  if (w >= 2) return '4';                           // 四分音符
  if (Math.abs(w - 1.5) < 0.01) return '8{d}';     // 附点八分
  if (w >= 1) return '8';                           // 八分音符
  if (Math.abs(w - 0.75) < 0.01) return '16{d}';   // 附点十六分
  if (w >= 0.5) return '16';                        // 十六分音符
  return '32';
}


// ---- TMD 生成 ----

function mToTex(m: TabMeasure, measures: TabMeasure[], mi: number): string {
  // 先构建每个 beat 的原始信息
  interface BeatInfo {
    notes: { fret: number; str: number }[];
    isRest: boolean;
    weight: number;
    chordMark: ChordRegion | undefined;
    brush: string | undefined;
  }

  const beatInfos: BeatInfo[] = [];
  for (let bi = 0; bi < m.beats.length; bi++) {
    const beat = m.beats[bi];
    const region = chordAt(measures, mi, bi);
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
    beatInfos.push({
      notes,
      isRest: !!beat.rest,
      weight: beat.weight,
      chordMark: m.chords.find(c => c.fromBeat === bi),
      brush: beat.brush,
    });
  }

  // ── sustain 合并 ──────────────────────────────────────────
  // 合并 sustain beat（空弦 + 非休止）到前一个有内容的 beat。
  // 例: 节奏型 D--- (下扫 + 3个延续) 在 8拍小节中:
  //   合并前: weight=1 的下扫 + 3个 weight=1 的空 beat → 4个八分音符
  //   合并后: weight=4 的下扫 → 一个二分音符
  // 这样扫弦才有正确的持续时长，而不是短促的八分音符 + 3个休止。
  // 合并条件: beat 无音符、非休止、无和弦标记（有和弦标记说明是新段落起点）
  interface MergedBeat {
    notes: { fret: number; str: number }[];
    isRest: boolean;
    weight: number;
    chordMark: ChordRegion | undefined;
    brush: string | undefined;
  }

  const merged: MergedBeat[] = [];
  for (const info of beatInfos) {
    const isEmpty = info.notes.length === 0 && !info.isRest;
    if (isEmpty && merged.length > 0 && !info.chordMark) {
      // sustain: 合并时值到前一个 beat
      merged[merged.length - 1].weight += info.weight;
    } else {
      merged.push({ ...info });
    }
  }

  // 输出 AlphaTex
  const parts: string[] = [];
  for (const b of merged) {
    const dur = weightToDur(b.weight);
    const pfx = b.chordMark ? `[${b.chordMark.name}]` : '';
    if (b.isRest || b.notes.length === 0) {
      parts.push(`${pfx}r.${dur}`);
    } else if (b.notes.length === 1) {
      parts.push(`${pfx}${b.notes[0].fret}.${b.notes[0].str}.${dur}`);
    } else {
      // ── brush duration (弦间延迟) ────────────────────────
      // AlphaTab 的 {ad N} / {au N} 中 N = 每根弦之间的延迟毫秒数。
      // N 越大扫弦感越明显，太小则像拨弦（所有弦几乎同时发声）。
      //
      // 调参历史: 默认值 → 120ms(太慢) → 40ms(太像拨) → 60/50ms(当前)
      //
      // 下扫 60ms vs 上扫 50ms:
      //   真实弹奏中上扫（手腕回弹）比下扫（重力顺势）更快，
      //   10ms 差异在听感上制造微妙的方向区别。
      //
      // ds (dead stroke / 闷音) 不接受 duration 参数，
      //   AlphaTab 会报 AT220 "unexpected additional arguments"。
      let bm = '';
      if (b.brush === 'ad') bm = ' {ad 60}';
      else if (b.brush === 'au') bm = ' {au 50}';
      else if (b.brush === 'ds') bm = ' {ds}';
      else if (b.brush) bm = ` {${b.brush} 60}`;
      parts.push(`${pfx}(${b.notes.map(n => `${n.fret}.${n.str}`).join(' ')}).${dur}${bm}`);
    }
  }
  return parts.join(' ');
}

/**
 * 生成小节行 chord line
 *
 * token 数量严格等于拍号分子（4/4 → 4 个 token，3/4 → 3 个 token）。
 * 每个 token 对应一拍：有和弦起始或 rhythmId 变化 → 和弦名+@rid，否则 → "."（延续）。
 *
 * 关键：同一个和弦区间内，如果 rhythmId 发生变化，需要在变化点重新输出和弦名。
 * 例：G 占整个小节，前半 R1 后半 R1Plus → | G@R1 . G@R1Plus . |
 *
 * @param m 小节数据
 * @param tsNumerator 拍号分子（默认 4）
 */
function mToChordLine(m: TabMeasure, tsNumerator = 4): string {
  const totalWeight = m.beats.reduce((s, b) => s + b.weight, 0);
  const weightPerBeat = totalWeight / tsNumerator;

  // 为每个 beat 计算 weight 起始位置
  const beatStarts: number[] = [];
  let wPos = 0;
  for (const b of m.beats) {
    beatStarts.push(wPos);
    wPos += b.weight;
  }

  // 辅助：根据 weight 位置找到对应的 beat index
  function beatIndexAtWeight(w: number): number {
    for (let bi = 0; bi < m.beats.length; bi++) {
      if (Math.abs(beatStarts[bi] - w) < 0.01) return bi;
    }
    return -1;
  }

  // 辅助：根据 beat index 找到所属的和弦名
  function chordNameAtBeat(bi: number): string | null {
    for (let i = m.chords.length - 1; i >= 0; i--) {
      if (m.chords[i].fromBeat <= bi && bi < m.chords[i].toBeat) return m.chords[i].name;
    }
    return null;
  }

  // 辅助：获取一个 token 覆盖范围内的 rhythmId 和 rhythmSeq
  function ridForToken(tokenIdx: number): { rid: string | undefined; seq: number | undefined } {
    const wStart = tokenIdx * weightPerBeat;
    const wEnd = wStart + weightPerBeat;
    for (let bi = 0; bi < m.beats.length; bi++) {
      if (beatStarts[bi] >= wStart - 0.01 && beatStarts[bi] < wEnd - 0.01) {
        if (m.beats[bi].rhythmId) {
          return { rid: m.beats[bi].rhythmId, seq: m.beats[bi].rhythmSeq };
        }
      }
    }
    return { rid: undefined, seq: undefined };
  }

  // 生成 tsNumerator 个 token
  //
  // 核心规则：
  //   @R1 只在节奏型区间起始处输出（rhythmSeq 变化时）
  //   区间内的和弦切换只输出和弦名（不带 @R1）
  //   和弦没变 + 同一区间 → .（延续）
  //
  // 例：前半小节 G+D 用 R1(seq=1)，后半 A7 用 R1(seq=2)
  //   → | G@R1 D A7@R1 . |
  //   G@R1 开始第一个 R1 区间，D 在区间内切换和弦，A7@R1 开始第二个区间
  const parts: string[] = [];
  let prevRid: string | undefined;
  let prevSeq: number | undefined;
  let prevChordName: string | null = null;

  for (let i = 0; i < tsNumerator; i++) {
    const beatStart = i * weightPerBeat;
    const bi = beatIndexAtWeight(beatStart);
    const { rid, seq } = ridForToken(i);
    const chordName = bi >= 0 ? chordNameAtBeat(bi) : null;

    const isChordStart = m.chords.some(c =>
      c.fromBeat < m.beats.length && Math.abs(beatStarts[c.fromBeat] - beatStart) < 0.01
    );

    // 节奏型区间边界：rid 或 seq 变了
    const regionChanged = i > 0 && (rid !== prevRid || seq !== prevSeq);
    // 和弦变了（同一区间内）
    const chordChanged = chordName !== prevChordName && chordName != null;

    if (regionChanged && chordName) {
      // 新的节奏型区间 → 和弦名@rid
      parts.push(rid ? `${chordName}@${rid}` : chordName);
    } else if (isChordStart && chordName) {
      if (i === 0 || regionChanged) {
        // 小节第一个 token 或区间起始 → 带 @rid
        parts.push(rid ? `${chordName}@${rid}` : chordName);
      } else {
        // 区间内的和弦起始 → 只输出和弦名，不带 @rid
        parts.push(chordName);
      }
    } else if (chordChanged && chordName) {
      // 区间内和弦切换（非 chord region 起始，但和弦名变了）
      parts.push(chordName);
    } else {
      parts.push('.');
    }

    prevRid = rid;
    prevSeq = seq;
    if (chordName != null) prevChordName = chordName;
  }

  return `| ${parts.join(' ')} |`;
}

/**
 * 生成单个段落的 TMD body（不含 header）
 *
 * @param tsLabel 拍号标签（如 "4/4"），用于确定 chord line 的 token 数量
 */
export function genSectionBody(
  measures: TabMeasure[],
  sectionName?: string,
  tsLabel?: string,
): { body: string; usedChords: ChordRegion[]; usedRhythmIds: string[] } {
  const section = sectionName?.trim() || 'Untitled';
  const tsNumerator = parseTsNumerator(tsLabel);
  const usedChords: ChordRegion[] = [];
  const seen = new Set<string>();
  const rhythmIds = new Set<string>();
  for (const m of measures) {
    for (const b of m.beats) {
      if (b.rhythmId) rhythmIds.add(b.rhythmId);
    }
    for (const c of m.chords) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        usedChords.push(c);
      }
    }
  }

  const lines = measures
    .map((m, i) => {
      if (!hasContent(m)) return null;
      const chordLine = mToChordLine(m, tsNumerator);
      // 有 rhythmId 的 beat 用节奏型引用，不展开 tex
      const hasRhythm = m.beats.some(b => b.rhythmId);
      if (hasRhythm) return chordLine;
      return `${chordLine}\ntex: ${mToTex(m, measures, i)}`;
    })
    .filter(Boolean).join('\n\n');

  if (!lines) return { body: '', usedChords, usedRhythmIds: [] };
  return { body: `[${section}]\n\n${lines}`, usedChords, usedRhythmIds: Array.from(rhythmIds) };
}

/**
 * 从使用的和弦区间生成 TMD define 行
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
          return String(f + pos.baseFret - 1);
        }).join(' ')
      : def.frets.map(f => f < 0 ? 'x' : String(f)).join(' ');
    defs.push(`define [${region.name}]: { frets: "${frets}" }`);
  }
  return defs;
}

/**
 * 生成 TMD header
 */
export function genTmdHeader(tempo: number, tsLabel: string, chordDefs: string[], rhythmDefs?: string[]): string {
  return [
    '---',
    `tempo: ${tempo}`,
    `time_signature: ${tsLabel}`,
    ...(rhythmDefs && rhythmDefs.length > 0 ? ['', ...rhythmDefs] : []),
    ...(chordDefs.length > 0 ? ['', ...chordDefs] : []),
    '---',
  ].join('\n');
}

/**
 * 从节奏型 ID 列表生成 TMD 定义行
 */
export function genRhythmDefs(rhythmIds: string[], rhythmMap?: Map<string, RhythmPattern>): string[] {
  if (!rhythmMap) return [];
  const defs: string[] = [];
  for (const id of rhythmIds) {
    const r = rhythmMap.get(id);
    if (r) defs.push(`@${r.id}: ${r.type}(${r.raw})`);
  }
  return defs;
}

/**
 * 生成单段落完整 TMD（header + [Section] + body）
 */
export function genTmd(
  measures: TabMeasure[],
  opts?: { bpm?: number; tsLabel?: string; sectionName?: string; rhythmMap?: Map<string, RhythmPattern> },
): string {
  const tempo = opts?.bpm ?? 72;
  const ts = opts?.tsLabel ?? '4/4';

  const { body, usedChords, usedRhythmIds } = genSectionBody(measures, opts?.sectionName, ts);
  if (!body) return '';

  const chordDefs = genChordDefs(usedChords);
  const rhythmDefs = genRhythmDefs(usedRhythmIds, opts?.rhythmMap);
  const header = genTmdHeader(tempo, ts, chordDefs, rhythmDefs);
  return `${header}\n\n${body}\n`;
}

/** 从拍号标签解析分子（如 "4/4" → 4, "3/4" → 3, "6/8" → 6） */
function parseTsNumerator(tsLabel?: string): number {
  if (!tsLabel) return 4;
  const m = tsLabel.match(/^(\d+)\s*\//);
  return m ? parseInt(m[1], 10) : 4;
}

export function splitRows(measures: TabMeasure[], cw: number): number[][] {
  const rows: number[][] = []; let row: number[] = []; let rowW = LABEL_W;
  for (let i = 0; i < measures.length; i++) {
    const mw = measureWidth(measures[i]);
    if (row.length > 0 && rowW + mw > cw) { rows.push(row); row = [i]; rowW = LABEL_W + mw; }
    else { row.push(i); rowW += mw; }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}
