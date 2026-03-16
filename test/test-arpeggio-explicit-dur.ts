/**
 * 验证不同 brushDuration 值
 */
import * as alphaTab from '@coderline/alphatab';

const durations = [60, 120, 240, 480];
const msPerTick = (60000 / 72) / 960;

for (const dur of durations) {
  const tex = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).16 {ad ${dur}} (0.1 1.2 0.3 2.4 3.5).16 {au ${dur}} r.16 r.16 r.16 r.16 r.16 r.16 |`;
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, new alphaTab.Settings());
  try {
    const score = imp.readScore();
    const voice = score.tracks[0].staves[0].bars[0].voices[0];
    const b0 = voice.beats[0];
    const b1 = voice.beats[1];
    const perString = (dur / 4) | 0; // 5弦, 4个间隔
    console.log(`dur=${dur}: ${(dur * msPerTick).toFixed(0)}ms total, ${(perString * msPerTick).toFixed(0)}ms/string — ad=${alphaTab.model.BrushType[b0.brushType]}(${b0.brushDuration}) au=${alphaTab.model.BrushType[b1.brushType]}(${b1.brushDuration})`);
  } catch (e: any) {
    console.error(`dur=${dur}: ❌ ${e.message}`);
  }
}
