/**
 * 测试 16 slot 节奏型填入 16 拍位
 * 节奏型: ⬇下─延─延─延⬇下─延⬇下⬆上✕闷⬆上⬇下⬆上⬇下─延⬇下⬆上
 */
import type { RhythmPattern, GuitarFrets } from '../src/core/types';
import { expandRhythm } from '../src/core/rhythm/expander';

const rhythm16: RhythmPattern = {
  id: 'R16', type: 'strum', raw: 'D---D-DUxUDUD-DU',
  slots: [
    { kind: 'strum', action: 'down' },     // 0
    { kind: 'strum', action: 'sustain' },   // 1
    { kind: 'strum', action: 'sustain' },   // 2
    { kind: 'strum', action: 'sustain' },   // 3
    { kind: 'strum', action: 'down' },      // 4
    { kind: 'strum', action: 'sustain' },   // 5
    { kind: 'strum', action: 'down' },      // 6
    { kind: 'strum', action: 'up' },        // 7
    { kind: 'strum', action: 'mute' },      // 8
    { kind: 'strum', action: 'up' },        // 9
    { kind: 'strum', action: 'down' },      // 10
    { kind: 'strum', action: 'up' },        // 11
    { kind: 'strum', action: 'down' },      // 12
    { kind: 'strum', action: 'sustain' },   // 13
    { kind: 'strum', action: 'down' },      // 14
    { kind: 'strum', action: 'up' },        // 15
  ],
};

// C 和弦 frets [6弦→1弦]: x 3 2 0 1 0
const frets_C: GuitarFrets = [-1, 3, 2, 0, 1, 0];

// Am 和弦 frets [6弦→1弦]: x 0 2 2 1 0
const frets_Am: GuitarFrets = [-1, 0, 2, 2, 1, 0];

function testApply(label: string, frets: GuitarFrets, beatCount: number, rhythm: RhythmPattern) {
  const slotCount = rhythm.slots.length;
  console.log(`\n${label}: ${beatCount} beats × ${slotCount} slots`);
  console.log('弦序: E A D G B e (6→1)');
  console.log('---');

  for (let i = 0; i < beatCount; i++) {
    const slotIdx = Math.min(Math.floor(i * slotCount / beatCount), slotCount - 1);
    const slot = rhythm.slots[slotIdx];
    const action = slot.kind === 'strum' ? (slot as any).action : '?';

    if (slot.kind === 'strum' && (slot as any).action === 'sustain') {
      console.log(`  beat ${i.toString().padStart(2)}: slot ${slotIdx.toString().padStart(2)} [${action.padEnd(8)}] → (sustain, 空)`);
      continue;
    }

    const events = expandRhythm(rhythm.type, [slot], frets);
    const ev = events[0];

    if (ev && !ev.isRest && !ev.isSustain) {
      // 构建 6 弦显示 (index 0=1弦e, index 5=6弦E)
      const display = new Array(6).fill('-');
      for (const note of ev.notes) {
        const si = note.string - 1; // string 1→index 0
        if (si >= 0 && si < 6) {
          display[si] = ev.isDeadNote ? 'x' : String(note.fret);
        }
      }
      // 显示顺序: e B G D A E (1弦→6弦)
      console.log(`  beat ${i.toString().padStart(2)}: slot ${slotIdx.toString().padStart(2)} [${action.padEnd(8)}] → e=${display[0]} B=${display[1]} G=${display[2]} D=${display[3]} A=${display[4]} E=${display[5]}${ev.isDeadNote ? ' (DEAD)' : ''}`);
    } else {
      console.log(`  beat ${i.toString().padStart(2)}: slot ${slotIdx.toString().padStart(2)} [${action.padEnd(8)}] → (rest)`);
    }
  }
}

testApply('C 和弦 + 16 slot 节奏型', frets_C, 16, rhythm16);
testApply('Am 和弦 + 16 slot 节奏型', frets_Am, 16, rhythm16);

// 也测试 TabEditor 里的 frets 转换逻辑
console.log('\n=== 测试 frets 转换 ===');
// 模拟 resolveChord 返回的 ChordDefinition
// positions[0].frets 是相对品位, baseFret 是起始品位
// 绝对品位 = relFret + baseFret - 1 (relFret > 0 时)
// C 和弦 positions[0]: frets=[-1,3,2,0,1,0], baseFret=1
const cPos = { frets: [-1, 3, 2, 0, 1, 0] as GuitarFrets, baseFret: 1 };
const cAbsFrets = cPos.frets.map(f => f <= 0 ? f : f + cPos.baseFret - 1) as GuitarFrets;
console.log('C 相对品位:', cPos.frets);
console.log('C baseFret:', cPos.baseFret);
console.log('C 绝对品位:', cAbsFrets);

// Am 和弦 positions[0]: frets=[-1,0,2,2,1,0], baseFret=1
const amPos = { frets: [-1, 0, 2, 2, 1, 0] as GuitarFrets, baseFret: 1 };
const amAbsFrets = amPos.frets.map(f => f <= 0 ? f : f + amPos.baseFret - 1) as GuitarFrets;
console.log('Am 相对品位:', amPos.frets);
console.log('Am baseFret:', amPos.baseFret);
console.log('Am 绝对品位:', amAbsFrets);

// 高把位和弦测试: Bm positions[0]: frets=[-1,1,3,3,2,1], baseFret=2
const bmPos = { frets: [-1, 1, 3, 3, 2, 1] as GuitarFrets, baseFret: 2 };
const bmAbsFrets = bmPos.frets.map(f => f <= 0 ? f : f + bmPos.baseFret - 1) as GuitarFrets;
console.log('Bm 相对品位:', bmPos.frets);
console.log('Bm baseFret:', bmPos.baseFret);
console.log('Bm 绝对品位:', bmAbsFrets);
console.log('Bm 期望绝对品位: [-1, 2, 4, 4, 3, 2]');
