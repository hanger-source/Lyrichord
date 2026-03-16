/**
 * 调试：模拟 TabEditor 里的 applyRhythm（新版：替换 beat 数量）
 * 场景：8 拍 → 16 slot → 再 8 slot
 */
import type { RhythmPattern, GuitarFrets } from '../src/core/types';
import { expandRhythm } from '../src/core/rhythm/expander';
import { resolveChord } from '../src/core/chord/resolver';

type StringMark = { type: 'none' } | { type: 'chord' } | { type: 'custom'; fret: number };
type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];
interface ChordRegion { fromBeat: number; toBeat: number; name: string; positionIndex?: number; }
interface TabBeat { strings: Strings6; weight: number; group: number; rest?: boolean; brush?: 'bd' | 'bu' | 'ds'; }
interface TabMeasure { beats: TabBeat[]; chords: ChordRegion[]; }

function emptyStrings(): Strings6 {
  return [{ type: 'none' }, { type: 'none' }, { type: 'none' },
          { type: 'none' }, { type: 'none' }, { type: 'none' }];
}
function mkBeat(weight: number, group: number): TabBeat {
  return { strings: emptyStrings(), weight, group };
}

// 和 TabEditor 里完全一致的 applyRhythm
function applyRhythm(m: TabMeasure, rhythm: RhythmPattern, selFrom: number, selTo: number): TabMeasure {
  const next = structuredClone(m);
  const slotCount = rhythm.slots.length;
  const selBeatCount = selTo - selFrom + 1;

  let totalWeight = 0;
  for (let i = selFrom; i <= selTo; i++) totalWeight += next.beats[i].weight;
  const group0 = next.beats[selFrom].group;
  const perW = totalWeight / slotCount;
  const newBeats: TabBeat[] = [];
  for (let i = 0; i < slotCount; i++) {
    newBeats.push(mkBeat(perW, group0 + Math.floor(i * 4 / slotCount)));
  }
  const delta = slotCount - selBeatCount;
  next.beats.splice(selFrom, selBeatCount, ...newBeats);

  // 更新和弦区间
  for (const c of next.chords) {
    if (c.fromBeat >= selFrom + selBeatCount) {
      c.fromBeat += delta; c.toBeat += delta; continue;
    }
    if (c.toBeat > selFrom && c.fromBeat < selFrom + selBeatCount) {
      if (c.fromBeat >= selFrom) {
        c.fromBeat = selFrom + Math.round((c.fromBeat - selFrom) * slotCount / selBeatCount);
      }
      if (c.toBeat <= selFrom + selBeatCount) {
        c.toBeat = selFrom + Math.round((c.toBeat - selFrom) * slotCount / selBeatCount);
      } else {
        c.toBeat += delta;
      }
    }
  }

  // 1:1 映射 slot → beat
  for (let i = 0; i < slotCount; i++) {
    const bi = selFrom + i;
    if (bi >= next.beats.length) break;
    const chord = next.chords.find(c => c.fromBeat <= bi && bi < c.toBeat);
    if (!chord) continue;
    const def = resolveChord(chord.name);
    if (!def) continue;
    const posIdx = chord.positionIndex ?? 0;
    const cpos = def.positions?.[posIdx];
    const frets: GuitarFrets = cpos
      ? cpos.frets.map(f => f <= 0 ? f : f + cpos.baseFret - 1) as GuitarFrets
      : def.frets;
    const beat = next.beats[bi];
    const slot = rhythm.slots[i];
    const strings = emptyStrings();
    if (slot.kind === 'strum' && slot.action === 'sustain') {
      beat.strings = strings; beat.brush = undefined; continue;
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
    if (ev?.isDeadNote) beat.brush = 'ds';
    else if (ev?.brushDirection === 'down') beat.brush = 'bd';
    else if (ev?.brushDirection === 'up') beat.brush = 'bu';
    else beat.brush = undefined;
    beat.strings = strings;
  }
  return next;
}

function showBeats(m: TabMeasure, label: string) {
  console.log(`\n${label} (${m.beats.length} beats, chords: ${JSON.stringify(m.chords)})`);
  for (let bi = 0; bi < m.beats.length; bi++) {
    const b = m.beats[bi];
    const frets = b.strings.map(s => {
      if (s.type === 'none') return '-';
      if (s.type === 'custom') return String(s.fret);
      return 'C';
    });
    const brush = b.brush ? ` [${b.brush}]` : '';
    console.log(`  beat ${bi.toString().padStart(2)} (w=${b.weight.toFixed(3)}, g=${b.group}): ${frets.join('')}${brush}`);
  }
}

// 用户的节奏型: "下---下-下上空上下上下-下上"
const rhythm16: RhythmPattern = {
  id: 'R16', type: 'strum', raw: 'D---D-DUxUDUD-DU',
  slots: [
    { kind: 'strum', action: 'down' },     // 1拍: 下
    { kind: 'strum', action: 'sustain' },   //      ---
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' },      // 2拍: 下
    { kind: 'strum', action: 'sustain' },   //      -
    { kind: 'strum', action: 'down' },      //      下
    { kind: 'strum', action: 'up' },        //      上
    { kind: 'strum', action: 'mute' },      // 3拍: 空(闷)
    { kind: 'strum', action: 'up' },        //      上
    { kind: 'strum', action: 'down' },      //      下
    { kind: 'strum', action: 'up' },        //      上
    { kind: 'strum', action: 'down' },      // 4拍: 下
    { kind: 'strum', action: 'sustain' },   //      -
    { kind: 'strum', action: 'down' },      //      下
    { kind: 'strum', action: 'up' },        //      上
  ],
};

// 8 slot 节奏型: "下 下上 空上 下上"
const rhythm8: RhythmPattern = {
  id: 'R8', type: 'strum', raw: 'D-DUxUDU',
  slots: [
    { kind: 'strum', action: 'down' },      // 1拍: 下
    { kind: 'strum', action: 'sustain' },    //      -
    { kind: 'strum', action: 'down' },       // 2拍: 下
    { kind: 'strum', action: 'up' },         //      上
    { kind: 'strum', action: 'mute' },       // 3拍: 空
    { kind: 'strum', action: 'up' },         //      上
    { kind: 'strum', action: 'down' },       // 4拍: 下
    { kind: 'strum', action: 'up' },         //      上
  ],
};

// 初始: 8 拍, C 和弦
const m0: TabMeasure = {
  beats: Array.from({ length: 8 }, (_, i) => mkBeat(1, Math.floor(i / 2))),
  chords: [{ fromBeat: 0, toBeat: 8, name: 'C', positionIndex: 0 }],
};

showBeats(m0, '初始 8 拍');

// 第一步: 应用 16 slot
const m1 = applyRhythm(m0, rhythm16, 0, 7);
showBeats(m1, '应用 16 slot 后');

// 第二步: 选中全部 16 拍, 应用 8 slot
const m2 = applyRhythm(m1, rhythm8, 0, 15);
showBeats(m2, '再应用 8 slot 后');

// 验证第二步的期望:
// 8 slot: 下 - 下 上 空 上 下 上
console.log('\n=== 验证 ===');
const expected8 = ['down', 'sustain', 'down', 'up', 'mute', 'up', 'down', 'up'];
let ok = true;
for (let i = 0; i < 8; i++) {
  const b = m2.beats[i];
  const hasNotes = b.strings.some(s => s.type !== 'none');
  const isSustain = expected8[i] === 'sustain';
  const correct = isSustain ? !hasNotes : hasNotes;
  if (!correct) { ok = false; console.log(`  beat ${i}: 期望 ${expected8[i]}, hasNotes=${hasNotes} ✗`); }
}
console.log(ok ? '✅ 全部正确' : '❌ 有错误');

// 也测试用户说的具体场景: 先 16 slot 再 8 slot 的 frets 输出
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

console.log('\n=== TEX 输出 ===');
console.log('16 slot:', mToTex(m1, [m1], 0));
console.log('8 slot:', mToTex(m2, [m2], 0));
