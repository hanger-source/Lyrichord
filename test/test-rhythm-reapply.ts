/**
 * 测试：先填 16 slot，再填 8 slot，验证自动调整拍数逻辑 v2
 */
import type { RhythmPattern, GuitarFrets } from '../src/core/types';
import { expandRhythm } from '../src/core/rhythm/expander';
import { resolveChord } from '../src/core/chord/resolver';

type StringMark = { type: 'none' } | { type: 'chord' } | { type: 'custom'; fret: number };
type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];
interface ChordRegion { fromBeat: number; toBeat: number; name: string; positionIndex?: number; }
interface TabBeat { strings: Strings6; weight: number; group: number; rest?: boolean; }
interface TabMeasure { beats: TabBeat[]; chords: ChordRegion[]; }

function emptyStrings(): Strings6 {
  return [{ type: 'none' }, { type: 'none' }, { type: 'none' },
          { type: 'none' }, { type: 'none' }, { type: 'none' }];
}
function mkBeat(w: number, g: number): TabBeat {
  return { strings: emptyStrings(), weight: w, group: g };
}

function applyRhythm(m: TabMeasure, rhythm: RhythmPattern, selFrom: number, selTo: number): TabMeasure {
  const next = structuredClone(m);
  const slotCount = rhythm.slots.length;
  const selBeatCount = selTo - selFrom + 1;

  // 计算选中范围的总 weight
  let totalWeight = 0;
  for (let i = selFrom; i <= selTo; i++) totalWeight += next.beats[i].weight;
  const group0 = next.beats[selFrom].group;

  // 用 slotCount 个新 beat 替换选中范围
  const perW = totalWeight / slotCount;
  const newBeats: TabBeat[] = [];
  for (let i = 0; i < slotCount; i++) {
    newBeats.push(mkBeat(perW, group0 + Math.floor(i * 4 / slotCount)));
  }
  const delta = slotCount - selBeatCount; // 拍数变化量

  // 替换 beats
  next.beats.splice(selFrom, selBeatCount, ...newBeats);

  // 更新和弦区间：选中范围内的按比例缩放，范围后的偏移
  for (const c of next.chords) {
    // 完全在选中范围之后
    if (c.fromBeat >= selFrom + selBeatCount) {
      c.fromBeat += delta;
      c.toBeat += delta;
      continue;
    }
    // 和选中范围有交集
    if (c.toBeat > selFrom && c.fromBeat < selFrom + selBeatCount) {
      // fromBeat 在范围内
      if (c.fromBeat >= selFrom) {
        c.fromBeat = selFrom + Math.round((c.fromBeat - selFrom) * slotCount / selBeatCount);
      }
      // toBeat 在范围内或刚好在边界
      if (c.toBeat <= selFrom + selBeatCount) {
        c.toBeat = selFrom + Math.round((c.toBeat - selFrom) * slotCount / selBeatCount);
      } else {
        // toBeat 超出选中范围
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
    if (slot.kind === 'strum' && (slot as any).action === 'sustain') {
      beat.strings = strings; continue;
    }
    const events = expandRhythm(rhythm.type, [slot], frets);
    const ev = events[0];
    if (ev && !ev.isRest && !ev.isSustain) {
      for (const note of ev.notes) {
        const si = note.string - 1;
        if (si >= 0 && si < 6) {
          strings[si] = ev.isDeadNote ? { type: 'custom', fret: 0 } : { type: 'custom', fret: note.fret };
        }
      }
    }
    beat.strings = strings;
  }
  return next;
}

const rhythm16: RhythmPattern = {
  id: 'R16', type: 'strum', raw: 'D---D-DUxUDUD-DU',
  slots: [
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'sustain' }, { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'mute' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
  ],
};
const rhythm8: RhythmPattern = {
  id: 'R8', type: 'strum', raw: 'D-DUxUDU',
  slots: [
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'mute' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
  ],
};
const rhythm4: RhythmPattern = {
  id: 'R4', type: 'strum', raw: 'DUDU',
  slots: [
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' }, { kind: 'strum', action: 'up' },
  ],
};

function buildMeasure(chord: string, beatCount: number): TabMeasure {
  const beats: TabBeat[] = [];
  for (let i = 0; i < beatCount; i++) beats.push(mkBeat(1, Math.floor(i / 2)));
  return { beats, chords: [{ fromBeat: 0, toBeat: beatCount, name: chord, positionIndex: 0 }] };
}

function showBeats(m: TabMeasure, label: string) {
  console.log(`${label}: ${m.beats.length} 拍, 和弦: ${JSON.stringify(m.chords)}`);
  for (let bi = 0; bi < m.beats.length; bi++) {
    const b = m.beats[bi];
    const has = b.strings.some(s => s.type !== 'none');
    console.log(`  beat ${bi.toString().padStart(2)} (w=${b.weight.toFixed(2)}): ${has ? '♪' : '─'}`);
  }
}

// 场景 1: 8拍 → 16slot → 8slot
console.log('=== 场景1: 8拍 → 16slot → 8slot ===');
const m1 = buildMeasure('C', 8);
const a1 = applyRhythm(m1, rhythm16, 0, 7);
showBeats(a1, '填16slot后');
const a2 = applyRhythm(a1, rhythm8, 0, 15);
showBeats(a2, '再填8slot后');

// 场景 2: 8拍 → 4slot
console.log('\n=== 场景2: 8拍 → 4slot ===');
const m2 = buildMeasure('Am', 8);
const a3 = applyRhythm(m2, rhythm4, 0, 7);
showBeats(a3, '填4slot后');

// 场景 3: 4拍 → 16slot → 4slot
console.log('\n=== 场景3: 4拍 → 16slot → 4slot ===');
const m3 = buildMeasure('G', 4);
const a4 = applyRhythm(m3, rhythm16, 0, 3);
showBeats(a4, '填16slot后');
const a5 = applyRhythm(a4, rhythm4, 0, 15);
showBeats(a5, '再填4slot后');

// 场景 4: 8拍 → 16slot → 16slot (同数量重填)
console.log('\n=== 场景4: 8拍 → 16slot → 16slot ===');
const m4 = buildMeasure('D', 8);
const a6 = applyRhythm(m4, rhythm16, 0, 7);
showBeats(a6, '填16slot后');
const a7 = applyRhythm(a6, rhythm16, 0, 15);
showBeats(a7, '再填16slot后');
