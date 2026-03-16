/**
 * 完整模拟 applyRhythm 流程，使用真实的 resolveChord
 */
import type { RhythmPattern, GuitarFrets } from '../src/core/types';
import { expandRhythm } from '../src/core/rhythm/expander';
import { resolveChord } from '../src/core/chord/resolver';

const rhythm16: RhythmPattern = {
  id: 'R16', type: 'strum', raw: 'D---D-DUxUDUD-DU',
  slots: [
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'mute' },
    { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'up' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'sustain' },
    { kind: 'strum', action: 'down' },
    { kind: 'strum', action: 'up' },
  ],
};

// 测试和弦
for (const chordName of ['C', 'Am', 'Bm', 'G', 'D', 'F']) {
  const def = resolveChord(chordName);
  if (!def) { console.log(`${chordName}: NOT FOUND`); continue; }

  console.log(`\n=== ${chordName} ===`);
  console.log('def.frets:', def.frets);
  console.log('positions count:', def.positions?.length ?? 0);
  if (def.positions?.[0]) {
    const p = def.positions[0];
    console.log('pos[0].frets:', p.frets);
    console.log('pos[0].baseFret:', p.baseFret);
    const absFrets = p.frets.map(f => f <= 0 ? f : f + p.baseFret - 1) as GuitarFrets;
    console.log('pos[0] 绝对品位:', absFrets);
  }

  // 模拟 applyRhythm 的 frets 计算
  const posIdx = 0;
  const cpos = def.positions?.[posIdx];
  const frets: GuitarFrets = cpos
    ? cpos.frets.map(f => f <= 0 ? f : f + cpos.baseFret - 1) as GuitarFrets
    : def.frets;

  console.log('applyRhythm 使用的 frets:', frets);

  // 模拟 16 拍填入
  console.log('--- 16 拍填入结果 ---');
  const selBeatCount = 16;
  const slotCount = rhythm16.slots.length;

  for (let i = 0; i < selBeatCount; i++) {
    const slotIdx = Math.min(Math.floor(i * slotCount / selBeatCount), slotCount - 1);
    const slot = rhythm16.slots[slotIdx];

    if (slot.kind === 'strum' && (slot as any).action === 'sustain') {
      console.log(`  beat ${i.toString().padStart(2)}: sustain → 空`);
      continue;
    }

    const events = expandRhythm(rhythm16.type, [slot], frets);
    const ev = events[0];

    // 模拟 strings 数组 (si 0=1弦e, 5=6弦E)
    const strings = new Array(6).fill('-');
    if (ev && !ev.isRest && !ev.isSustain) {
      for (const note of ev.notes) {
        const si = note.string - 1;
        if (si >= 0 && si < 6) {
          strings[si] = ev.isDeadNote ? 'x' : String(note.fret);
        }
      }
    }
    const action = (slot as any).action ?? '?';
    console.log(`  beat ${i.toString().padStart(2)}: [${action.padEnd(5)}] → e=${strings[0]} B=${strings[1]} G=${strings[2]} D=${strings[3]} A=${strings[4]} E=${strings[5]}`);
  }
}
