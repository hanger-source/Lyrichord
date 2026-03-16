/**
 * 端到端验证：voicing.ts + alphatex.ts 修复后
 * 输出的 AlphaTex string 编号是否正确
 */
import * as alphaTab from '@coderline/alphatab';
import { findRoot, getPlayableNotes, notesToAlphaTex } from '../src/core/chord/voicing';
import type { GuitarFrets } from '../src/core/types';

// C和弦: x 3 2 0 1 0 (E A D G B e, frets数组从低到高)
const cFrets: GuitarFrets = [-1, 3, 2, 0, 1, 0];

console.log('=== voicing.ts 输出验证 ===');
const root = findRoot(cFrets);
console.log(`findRoot: string=${root.string}, fret=${root.fret}`);
// 应该是 string=2 (A弦, frets[1]=3), 因为 E弦(frets[0]=-1) 不弹

const playable = getPlayableNotes(cFrets);
console.log(`getPlayableNotes: ${playable.map(n => `${n.fret}.${n.string}`).join(' ')}`);
// 应该是: 3.2 2.3 0.4 1.5 0.6 (AlphaTex string: 2=A, 3=D, 4=G, 5=B, 6=e)

const tex = notesToAlphaTex(playable);
console.log(`notesToAlphaTex: ${tex}`);

// 用 AlphaTab 解析验证
const fullTex = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n${tex}.1 {ad ch "C"} |`;
console.log(`\n完整 AlphaTex: ${fullTex}`);

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(fullTex, settings);

try {
  const score = importer.readScore();
  const tuning = score.tracks[0].staves[0].tuning;
  const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  
  console.log(`\n解析结果:`);
  console.log(`  brushType: ${alphaTab.model.BrushType[beat.brushType]}`);
  console.log(`  brushDuration: ${beat.brushDuration}`);
  console.log(`  chordId: ${beat.chordId}`);
  
  const expected = [
    { str: 'A', midi: 48 },  // A弦 fret 3
    { str: 'D', midi: 52 },  // D弦 fret 2
    { str: 'G', midi: 55 },  // G弦 fret 0
    { str: 'B', midi: 60 },  // B弦 fret 1
    { str: 'e', midi: 64 },  // e弦 fret 0
  ];
  
  let allCorrect = true;
  for (let i = 0; i < beat.notes.length; i++) {
    const n = beat.notes[i];
    const realValue = tuning[n.string - 1] + n.fret;
    const exp = expected[i];
    const ok = realValue === exp.midi;
    if (!ok) allCorrect = false;
    console.log(`  note ${i}: string=${n.string}, fret=${n.fret}, MIDI=${realValue} ${ok ? '✓' : `✗ (expected ${exp.midi} for ${exp.str}弦)`}`);
  }
  
  console.log(allCorrect ? '\n✅ 所有音高正确！' : '\n❌ 有音高错误');
} catch (e: any) {
  console.error('解析失败:', e.message);
}
