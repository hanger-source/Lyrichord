/**
 * 直接用 AlphaTab API 验证 {bd} 和 {bu} 是否真的生效
 */
import * as alphaTab from '@coderline/alphatab';

// 测试1: 纯 {bd}/{bu}
const tex1 = `\\tempo 60\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).4 {bd} (0.1 1.2 0.3 2.4 3.5).4 {bu} (0.1 1.2 0.3 2.4 3.5).4 {bd} (0.1 1.2 0.3 2.4 3.5).4 {bu} |`;

// 测试2: 合并格式 {bd ch "C"}（和 generateTexPassthrough 输出一致）
const tex2 = `\\tempo 60\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).4 {bd ch "C"} (0.1 1.2 0.3 2.4 3.5).4 {bu} (0.1 1.2 0.3 2.4 3.5).4 {bd} (0.1 1.2 0.3 2.4 3.5).4 {bu} |`;

// 测试3: 16分音符（和实际场景一致）
const tex3 = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).16 {bd ch "C"} r.16 r.16 r.16 (0.1 1.2 0.3 2.4 3.5).16 {bd} r.16 (0.1 1.2 0.3 2.4 3.5).16 {bd} (0.1 1.2 0.3 2.4 3.5).16 {bu} |`;

const tex = tex3;

console.log('=== 输入 AlphaTex ===');
console.log(tex);

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(tex, settings);

try {
  const score = importer.readScore();
  console.log('解析成功！');
  console.log(`Tracks: ${score.tracks.length}`);
  
  const track = score.tracks[0];
  const staff = track.staves[0];
  const bars = staff.bars;
  
  console.log(`Bars: ${bars.length}`);
  
  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi];
    const voice = bar.voices[0];
    console.log(`\nBar ${bi}: ${voice.beats.length} beats`);
    
    for (let i = 0; i < voice.beats.length; i++) {
      const beat = voice.beats[i];
      console.log(`  Beat ${i}:`);
      console.log(`    notes: ${beat.notes.length}`);
      console.log(`    brushType: ${beat.brushType} (${alphaTab.model.BrushType[beat.brushType]})`);
      console.log(`    brushDuration: ${beat.brushDuration}`);
      console.log(`    isRest: ${beat.isRest}`);
      if (beat.notes.length > 0) {
        console.log(`    strings: ${beat.notes.map(n => `${n.fret}.${n.string}`).join(' ')}`);
      }
    }
  }
} catch (e: any) {
  console.error('解析失败:', e.message);
  if (e.diagnostics) {
    for (const d of e.diagnostics) {
      console.error(`  ${d.severity}: ${d.message}`);
    }
  }
}
