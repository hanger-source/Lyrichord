import { tmdToAlphaTex } from './src/core/pipeline';
import { readFileSync } from 'fs';
import { durationToBeats } from './src/core/types';

const tmd = readFileSync('./src/data/demo-you-man-wo-man.tmd', 'utf-8');
const result = tmdToAlphaTex(tmd);

console.log('=== 管线结果 ===');
console.log('成功:', result.success);
console.log('错误数:', result.errors.length);
console.log('警告数:', result.warnings.length);

if (result.errors.length > 0) {
  console.log('\n错误:');
  for (const e of result.errors) {
    console.log(`  [${e.phase}] ${e.message}`);
  }
}

if (result.warnings.length > 0) {
  console.log('\n警告:');
  for (const w of result.warnings) {
    console.log(`  [${w.phase}] ${w.message}`);
  }
}

if (result.song) {
  const song = result.song;
  console.log('\n=== Song 概览 ===');
  console.log('标题:', song.meta.title);
  console.log('BPM:', song.meta.tempo);
  console.log('拍号:', `${song.meta.timeSignature.numerator}/${song.meta.timeSignature.denominator}`);
  console.log('Capo:', song.meta.capo);
  console.log('节奏型数:', song.rhythmLibrary.size);
  console.log('和弦库数:', song.chordLibrary.size);
  console.log('MasterBar 数:', song.masterBars.length);
  console.log('Bar 数:', song.bars.length);

  // 打印段落信息
  let currentSection = '';
  let sectionBars = 0;
  for (const mb of song.masterBars) {
    if (mb.section) {
      if (currentSection) console.log(`  [${currentSection}] ${sectionBars} 小节`);
      currentSection = mb.section.name;
      sectionBars = 1;
    } else {
      sectionBars++;
    }
  }
  if (currentSection) console.log(`  [${currentSection}] ${sectionBars} 小节`);

  // 打印前 2 个小节详情
  console.log('\n前 2 小节详情:');
  for (let i = 0; i < Math.min(2, song.bars.length); i++) {
    const bar = song.bars[i];
    const beatInfo = bar.beats.map(b => {
      const chord = b.chordId ?? (b.isRest ? '_' : '~');
      const dur = durationToBeats(b.duration).toFixed(1);
      return `${chord}(${dur}拍)"${b.lyrics ?? ''}"`;
    }).join(' | ');
    console.log(`  小节${i + 1}: [${beatInfo}]`);
  }
}

if (result.output) {
  console.log('\n=== AlphaTex 输出（前 1000 字符）===');
  console.log(result.output.tex.slice(0, 1000));
  console.log('\n... 总长度:', result.output.tex.length, '字符');
  console.log('小节数:', result.output.measures.length);
}
