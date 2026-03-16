/**
 * 验证两件事：
 * 1. AlphaTex string 编号约定（string 1 = 高音e 还是 低音E？）
 * 2. {ad}/{au} arpeggio 效果是否正常解析
 */
import * as alphaTab from '@coderline/alphatab';

// 测试1: 单音符 — 确认 string 编号
// 我们输入 0.1（fret=0, string=1），看 AlphaTab 解析后 note.string 是多少
const texSingle = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n0.1.4 0.2.4 0.3.4 0.6.4 |`;

console.log('=== 测试1: String 编号约定 ===');
const s1 = new alphaTab.Settings();
const imp1 = new alphaTab.importer.AlphaTexImporter();
imp1.initFromString(texSingle, s1);
try {
  const score = imp1.readScore();
  const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  // 标准吉他 tuning: E2 A2 D3 G3 B3 E4 (6弦到1弦)
  const tuning = score.tracks[0].staves[0].tuning;
  console.log(`Tuning (${tuning.length} strings): ${tuning.join(', ')}`);
  for (let i = 0; i < beats.length; i++) {
    const n = beats[i].notes[0];
    console.log(`  输入 0.${[1,2,3,6][i]} → 内部 note.string=${n.string}, note.fret=${n.fret}`);
  }
  console.log('结论: string 1 在 AlphaTex 中代表哪根弦？看 tuning[note.string-1] 的音高');
} catch (e: any) {
  console.error('解析失败:', e.message);
}

// 测试2: {ad}/{au} arpeggio 解析
const texArp = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).4 {ad} (0.1 1.2 0.3 2.4 3.5).4 {au} r.2 |`;

console.log('\n=== 测试2: Arpeggio {ad}/{au} 解析 ===');
const s2 = new alphaTab.Settings();
const imp2 = new alphaTab.importer.AlphaTexImporter();
imp2.initFromString(texArp, s2);
try {
  const score = imp2.readScore();
  const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    console.log(`  Beat ${i}: brushType=${b.brushType} (${alphaTab.model.BrushType[b.brushType]}), brushDuration=${b.brushDuration}, notes=${b.notes.length}`);
  }
} catch (e: any) {
  console.error('解析失败:', e.message);
}

// 测试3: {ad ch "C"} 合并格式
const texMerged = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).4 {ad ch "C"} (0.1 1.2 0.3 2.4 3.5).4 {au ch "C"} r.2 |`;

console.log('\n=== 测试3: 合并格式 {ad ch "C"} ===');
const s3 = new alphaTab.Settings();
const imp3 = new alphaTab.importer.AlphaTexImporter();
imp3.initFromString(texMerged, s3);
try {
  const score = imp3.readScore();
  const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    console.log(`  Beat ${i}: brushType=${alphaTab.model.BrushType[b.brushType]}, brushDuration=${b.brushDuration}, chordId="${b.chordId || ''}", notes=${b.notes.length}`);
  }
  console.log('成功！');
} catch (e: any) {
  console.error('解析失败:', e.message);
}
