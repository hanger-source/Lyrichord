/**
 * 验证 {ad} vs {au} 在 AlphaTab model 层的差异
 * 以及计算实际时间偏移
 */
import * as alphaTab from '@coderline/alphatab';

// 测试1: ad vs au
const tex = `\\tempo 72
\\instrument acousticguitarsteel
\\ts 4 4
.
(0.1 1.2 0.3 2.4 3.5).2 {ad} (0.1 1.2 0.3 2.4 3.5).2 {au} |`;

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(tex, settings);
const score = importer.readScore();

const bar = score.tracks[0].staves[0].bars[0];
const voice = bar.voices[0];
const staff = bar.staff;

console.log(`Tuning: ${staff.tuning.join(', ')}`);

for (let i = 0; i < voice.beats.length; i++) {
  const beat = voice.beats[i];
  const label = alphaTab.model.BrushType[beat.brushType];
  console.log(`\nBeat ${i}: ${label}, brushDuration=${beat.brushDuration}`);
  
  if (beat.brushType === alphaTab.model.BrushType.None) continue;
  
  const isDown = beat.brushType === alphaTab.model.BrushType.ArpeggioDown ||
                 beat.brushType === alphaTab.model.BrushType.BrushDown;
  
  // 模拟 _getBrushInfo: 标记哪些弦被使用
  const brushInfo: number[] = new Array(staff.tuning.length).fill(-1);
  for (const n of beat.notes) {
    brushInfo[n.string - 1] = 0;
  }
  
  let stringCount = 0;
  for (const v of brushInfo) { if (v >= 0) stringCount++; }
  
  const brushIncrement = stringCount > 1 ? (beat.brushDuration / (stringCount - 1)) | 0 : 0;
  
  // 模拟 _fillBrushInfo
  let strokeIdx = 0;
  for (let j = 0; j < brushInfo.length; j++) {
    const index = isDown ? j : (brushInfo.length - 1 - j);
    if (brushInfo[index] >= 0) {
      brushInfo[index] = strokeIdx * brushIncrement;
      strokeIdx++;
    }
  }
  
  const msPerTick = (60000 / 72) / 960;
  console.log(`  increment=${brushIncrement} ticks, total=${beat.brushDuration} ticks = ${(beat.brushDuration * msPerTick).toFixed(0)}ms`);
  
  for (let j = 0; j < brushInfo.length; j++) {
    if (brushInfo[j] < 0) continue;
    const tuning = staff.tuning[j];
    const note = beat.notes.find(n => n.string === j + 1);
    const fret = note ? note.fret : '?';
    console.log(`  string ${j+1} (tuning=${tuning}, fret=${fret}): offset=${brushInfo[j]} ticks = ${(brushInfo[j] * msPerTick).toFixed(0)}ms`);
  }
}

// 测试2: bd vs bu (对比)
console.log('\n\n=== 对比: {bd} vs {bu} ===');
const tex2 = `\\tempo 72
\\instrument acousticguitarsteel
\\ts 4 4
.
(0.1 1.2 0.3 2.4 3.5).2 {bd} (0.1 1.2 0.3 2.4 3.5).2 {bu} |`;

const imp2 = new alphaTab.importer.AlphaTexImporter();
imp2.initFromString(tex2, new alphaTab.Settings());
const score2 = imp2.readScore();
const voice2 = score2.tracks[0].staves[0].bars[0].voices[0];

for (let i = 0; i < voice2.beats.length; i++) {
  const beat = voice2.beats[i];
  console.log(`Beat ${i}: ${alphaTab.model.BrushType[beat.brushType]}, brushDuration=${beat.brushDuration}`);
}
