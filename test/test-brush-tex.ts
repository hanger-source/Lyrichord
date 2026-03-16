/**
 * 验证 mToTex 输出的 brush 标记
 */
type StringMark = { type: 'none' } | { type: 'chord' } | { type: 'custom'; fret: number };
type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];
interface ChordRegion { fromBeat: number; toBeat: number; name: string; positionIndex?: number; }
interface TabBeat { strings: Strings6; weight: number; group: number; rest?: boolean; brush?: 'bd' | 'bu' | 'ds'; }
interface TabMeasure { beats: TabBeat[]; chords: ChordRegion[]; }

import { resolveChord } from '../src/core/chord/resolver';

function emptyStrings(): Strings6 {
  return [{ type: 'none' }, { type: 'none' }, { type: 'none' },
          { type: 'none' }, { type: 'none' }, { type: 'none' }];
}

function chordFretForString(name: string, si: number, posIdx?: number): number {
  const def = resolveChord(name);
  if (!def) return 0;
  const pos = def.positions?.[posIdx ?? 0];
  if (pos) { const f = pos.frets[5 - si]; return f <= 0 ? f : f + pos.baseFret - 1; }
  return def.frets[5 - si];
}

function chordAt(measures: TabMeasure[], mi: number, bi: number): ChordRegion | null {
  const mc = measures[mi].chords;
  for (let i = mc.length - 1; i >= 0; i--) {
    if (mc[i].fromBeat <= bi && bi < mc[i].toBeat) return mc[i];
  }
  return null;
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
    for (let si = 0; si < 6; si++) {
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
      const bm = beat.brush ? ` {${beat.brush}}` : '';
      parts.push(`${pfx}${notes[0].fret}.${notes[0].str}.${dur}${bm}`);
    } else {
      const bm = beat.brush ? ` {${beat.brush}}` : '';
      parts.push(`${pfx}(${notes.map(n => `${n.fret}.${n.str}`).join(' ')}).${dur}${bm}`);
    }
  }
  return parts.join(' ');
}

// 构建测试小节: C 和弦, 4 拍, 带 brush
const m: TabMeasure = {
  beats: [
    { strings: [
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 1 },
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 2 },
      { type: 'custom', fret: 3 }, { type: 'none' },
    ], weight: 1, group: 0, brush: 'bd' },
    { strings: emptyStrings(), weight: 1, group: 0 }, // sustain
    { strings: [
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 1 },
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 2 },
      { type: 'custom', fret: 3 }, { type: 'none' },
    ], weight: 1, group: 1, brush: 'bu' },
    { strings: [
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 0 },
      { type: 'custom', fret: 0 }, { type: 'custom', fret: 0 },
      { type: 'custom', fret: 0 }, { type: 'none' },
    ], weight: 1, group: 1, brush: 'ds' },
  ],
  chords: [{ fromBeat: 0, toBeat: 4, name: 'C', positionIndex: 0 }],
};

const tex = mToTex(m, [m], 0);
console.log('AlphaTex:', tex);
console.log('');
console.log('期望包含: {bd}, {bu}, {ds}');
console.log('包含 bd:', tex.includes('{bd}'));
console.log('包含 bu:', tex.includes('{bu}'));
console.log('包含 ds:', tex.includes('{ds}'));
