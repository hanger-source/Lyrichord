import { tmdToAlphaTex } from '../src/core/pipeline';
import { readFileSync } from 'fs';
import { parsePluckPattern } from '../src/core/rhythm/pattern-parser';

// 先测试 R1 pattern 解析
const r1Pattern = 'p-3-(12)-3-p-3-(12)-3';
const r1Slots = parsePluckPattern(r1Pattern);
console.log('=== R1 Pattern 解析 ===');
console.log('Slot 数:', r1Slots.length);
for (let i = 0; i < r1Slots.length; i++) {
  const s = r1Slots[i];
  if (s.target === 'root') {
    console.log(`  [${i}] pluck root`);
  } else {
    console.log(`  [${i}] pluck strings: ${s.strings.join(',')}`);
  }
}

// 跑完整 pipeline
const tmd = readFileSync('./src/data/demo-you-man-wo-man.tmd', 'utf-8');
const result = tmdToAlphaTex(tmd);

if (result.errors.length > 0) {
  console.log('\n错误:');
  for (const e of result.errors) {
    console.log(`  [${e.phase}] ${e.message}`);
  }
}

if (result.output) {
  // 找到 A1 段落开始的位置，打印 R1 小节的 AlphaTex
  const lines = result.output.tex.split('\n');
  console.log('\n=== 完整 AlphaTex（逐行）===');
  let inA1 = false;
  let barCount = 0;
  for (const line of lines) {
    if (line.includes('\\section "A1"')) {
      inA1 = true;
      console.log('\n--- A1 段落开始 ---');
    }
    if (inA1) {
      console.log(line);
      if (line.includes('|')) barCount++;
      if (barCount >= 5) break;
    }
  }

  // 也打印 B1 段落（R1P）
  let inB1 = false;
  barCount = 0;
  for (const line of lines) {
    if (line.includes('\\section "B1"')) {
      inB1 = true;
      console.log('\n--- B1 段落开始 ---');
    }
    if (inB1) {
      console.log(line);
      if (line.includes('|')) barCount++;
      if (barCount >= 4) break;
    }
  }
}

// 打印 Song 中 A1 段落的 bar 详情
if (result.song) {
  const song = result.song;
  console.log('\n=== A1 段落 Bar 详情 ===');
  let inA1 = false;
  for (let i = 0; i < song.masterBars.length; i++) {
    const mb = song.masterBars[i];
    if (mb.section?.name === 'A1') inA1 = true;
    else if (mb.section && inA1) break;
    
    if (inA1) {
      const bar = song.bars[i];
      console.log(`\n小节 ${i}: rhythmId=${mb.rhythmId || '(继承)'}`);
      for (let j = 0; j < bar.beats.length; j++) {
        const b = bar.beats[j];
        console.log(`  beat[${j}]: chord=${b.chordId || '~'}, dur=${JSON.stringify(b.duration)}, lyrics="${b.lyrics || ''}", isRest=${b.isRest}`);
      }
    }
  }

  // 打印节奏型库
  console.log('\n=== 节奏型库 ===');
  for (const [id, rp] of song.rhythmLibrary) {
    console.log(`${id}: type=${rp.type}, raw="${rp.raw}", slots=${rp.slots.length}`);
    for (let i = 0; i < rp.slots.length; i++) {
      const s = rp.slots[i];
      if (s.kind === 'pluck') {
        console.log(`  [${i}] ${s.kind} ${s.target === 'root' ? 'root' : 'strings:' + (s as any).strings?.join(',')}`);
      } else {
        console.log(`  [${i}] ${s.kind} ${s.action}`);
      }
    }
  }
}
