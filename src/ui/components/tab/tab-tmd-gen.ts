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

function weightToDur(w: number): number {
  if (w >= 2) return 4; if (w >= 1) return 8; if (w >= 0.5) return 16; return 32;
}


// ---- TMD 生成 ----

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
    else if (notes.length === 1) {
      parts.push(`${pfx}${notes[0].fret}.${notes[0].str}.${dur}`);
    }
    else {
      const bm = beat.brush
        ? ` {${beat.brush}${beat.brush !== 'ds' ? ' 60' : ''}}`
        : '';
      parts.push(`${pfx}(${notes.map(n => `${n.fret}.${n.str}`).join(' ')}).${dur}${bm}`);
    }
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
 */
export function genTmd(measures: TabMeasure[], opts?: { bpm?: number; tsLabel?: string; sectionName?: string }): string {
  const tempo = opts?.bpm ?? 72;
  const ts = opts?.tsLabel ?? '4/4';

  const { body, usedChords } = genSectionBody(measures, opts?.sectionName);
  if (!body) return '';

  const chordDefs = genChordDefs(usedChords);
  const header = genTmdHeader(tempo, ts, chordDefs);
  return `${header}\n\n${body}\n`;
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
