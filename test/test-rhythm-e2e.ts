/**
 * 端到端测试：模拟 applyRhythm 新逻辑（自动拆拍 + 1:1 映射）
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
function mkBeat(weight: number, group: number): TabBeat {
  return { strings: emptyStrings(), weight, group };
}

function buildMeasure(chordName: string, beatCount: number): TabMeasure {
  const beats: TabBeat[] = [];
  for (let i = 0; i < beatCount; i++) beats.push(mkBeat(1, Math.floor(i / 2)));
  return { beats, chords: [{ fromBeat: 0, toBeat: beatCount, name: chordName, positionIndex: 0 }] };
}

// 新版 applyRhythm（和 TabEditor 里一致）
function applyRhythm(m: TabMeasure, rhythm: RhythmPattern, selFrom: number, selTo: number): TabMeasure {
  const next = structuredClone(m);
  const slotCount = rhythm.slots.length;
  let selBeatCount = selTo - selFrom + 1;

  // 自动拆拍
  if (slotCount > selBeatCount) {
    const ratio = Math.ceil(slotCount / selBeatCount);
    for (let idx = selBeatCount - 1; idx >= 0; idx--) {
      const bi = selFrom + idx;
      const b = next.beats[bi];
      const newW = b.weight / ratio;
      const splitted: TabBeat[] = [];
      for (let r = 0; r < ratio; r++) splitted.push(mkBeat(newW, b.group));
      next.beats.splice(bi, 1, ...splitted);
      const offset = ratio - 1;
      for (const c of next.chords) {
        if (c.fromBeat > bi) c.fromBeat += offset;
        if (c.toBeat > bi) c.toBeat += offset;
      }
    }
    selBeatCount = selBeatCount * ratio;
  }

  // 1:1 映射
  for (let i = 0; i < slotCount && i < selBeatCount; i++) {
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
    { kind: 'strum', action: 'down' },     // 0: ⬇
    { kind: 'strum', action: 'sustain' },   // 1: ─
    { kind: 'strum', action: 'sustain' },   // 2: ─
    { kind: 'strum', action: 'sustain' },   // 3: ─
    { kind: 'strum', action: 'down' },      // 4: ⬇
    { kind: 'strum', action: 'sustain' },   // 5: ─
    { kind: 'strum', action: 'down' },      // 6: ⬇
    { kind: 'strum', action: 'up' },        // 7: ⬆
    { kind: 'strum', action: 'mute' },      // 8: ✕
    { kind: 'strum', action: 'up' },        // 9: ⬆
    { kind: 'strum', action: 'down' },      // 10: ⬇
    { kind: 'strum', action: 'up' },        // 11: ⬆
    { kind: 'strum', action: 'down' },      // 12: ⬇
    { kind: 'strum', action: 'sustain' },   // 13: ─
    { kind: 'strum', action: 'down' },      // 14: ⬇
    { kind: 'strum', action: 'up' },        // 15: ⬆
  ],
};

// 期望的节拍分组 (4/4 拍, 每拍 4 个 16 分音符):
// 拍1: ⬇─── (slot 0-3)
// 拍2: ⬇─⬇⬆ (slot 4-7)
// 拍3: ✕⬆⬇⬆ (slot 8-11)
// 拍4: ⬇─⬇⬆ (slot 12-15)

const ACTIONS = ['down', 'sustain', 'sustain', 'sustain', 'down', 'sustain', 'down', 'up', 'mute', 'up', 'down', 'up', 'down', 'sustain', 'down', 'up'];

console.log('=== 测试: 16 slot 节奏型 → 8 拍小节 (应自动拆成 16 拍) ===\n');
const m8 = buildMeasure('C', 8);
console.log(`原始拍数: ${m8.beats.length}`);
const result = applyRhythm(m8, rhythm16, 0, 7);
console.log(`拆拍后拍数: ${result.beats.length}`);
console.log(`和弦区间: ${JSON.stringify(result.chords)}`);
console.log('');

let allCorrect = true;
for (let bi = 0; bi < result.beats.length; bi++) {
  const beat = result.beats[bi];
  const action = ACTIONS[bi] ?? '?';
  const hasNotes = beat.strings.some(s => s.type !== 'none');
  const isSustain = action === 'sustain';
  const display = beat.strings.map(s => {
    if (s.type === 'none') return '-';
    if (s.type === 'custom') return String(s.fret);
    return 'C';
  });
  const ok = isSustain ? !hasNotes : hasNotes;
  if (!ok) allCorrect = false;
  console.log(`  beat ${bi.toString().padStart(2)} (w=${beat.weight.toFixed(2)}): [${action.padEnd(8)}] → e=${display[0]} B=${display[1]} G=${display[2]} D=${display[3]} A=${display[4]} E=${display[5]} ${ok ? '✓' : '✗ WRONG'}`);
}
console.log(`\n结果: ${allCorrect ? '✅ 全部正确' : '❌ 有错误'}`);

// 也测试 16 拍 → 16 slot (不需要拆拍)
console.log('\n=== 测试: 16 slot 节奏型 → 16 拍小节 (不需要拆拍) ===\n');
const m16 = buildMeasure('C', 16);
const result16 = applyRhythm(m16, rhythm16, 0, 15);
console.log(`拍数: ${result16.beats.length} (不变)`);
let allCorrect2 = true;
for (let bi = 0; bi < result16.beats.length; bi++) {
  const beat = result16.beats[bi];
  const action = ACTIONS[bi];
  const hasNotes = beat.strings.some(s => s.type !== 'none');
  const isSustain = action === 'sustain';
  const ok = isSustain ? !hasNotes : hasNotes;
  if (!ok) allCorrect2 = false;
}
console.log(`结果: ${allCorrect2 ? '✅ 全部正确' : '❌ 有错误'}`);

// 测试 4 拍 → 4 slot
const rhythm4: RhythmPattern = {
  id: 'R4', type: 'strum', raw: 'DUDU',
  slots: [
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'up' },
  ],
};
console.log('\n=== 测试: 4 slot 节奏型 → 8 拍小节 (选中 4 拍) ===\n');
const m8b = buildMeasure('Am', 8);
const result4 = applyRhythm(m8b, rhythm4, 0, 3);
console.log(`拍数: ${result4.beats.length} (不变，4 slot ≤ 4 拍)`);
for (let bi = 0; bi < 4; bi++) {
  const beat = result4.beats[bi];
  const hasNotes = beat.strings.some(s => s.type !== 'none');
  console.log(`  beat ${bi}: hasNotes=${hasNotes}`);
}
