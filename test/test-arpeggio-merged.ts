/**
 * 验证 {ad 240 ch "C"} 合并格式能否正常解析
 */
import * as alphaTab from '@coderline/alphatab';

const tex = `\\tempo 72
\\instrument acousticguitarsteel
\\ts 4 4
.
(0.1 1.2 0.3 2.4 3.5).16 {ad 240 ch "C"} (0.1 1.2 0.3 2.4 3.5).16 {au 240 ch "C"} r.16 r.16 r.16 r.16 r.16 r.16 |`;

const imp = new alphaTab.importer.AlphaTexImporter();
imp.initFromString(tex, new alphaTab.Settings());

try {
  const score = imp.readScore();
  const voice = score.tracks[0].staves[0].bars[0].voices[0];
  for (let i = 0; i < 2; i++) {
    const b = voice.beats[i];
    console.log(`Beat ${i}: ${alphaTab.model.BrushType[b.brushType]}, dur=${b.brushDuration}, chord="${b.chordId}"`);
  }
  console.log('✅ 合并格式解析成功');
} catch (e: any) {
  console.error('❌', e.message);
}
