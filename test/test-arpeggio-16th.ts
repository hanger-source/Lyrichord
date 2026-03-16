/**
 * 验证 16 分音符下 arpeggio 的实际时间
 */
import * as alphaTab from '@coderline/alphatab';

const tex = `\\tempo 72
\\instrument acousticguitarsteel
\\ts 4 4
.
(0.1 1.2 0.3 2.4 3.5).16 {ad} (0.1 1.2 0.3 2.4 3.5).16 {au} r.16 r.16 r.16 r.16 r.16 r.16 |`;

const imp = new alphaTab.importer.AlphaTexImporter();
imp.initFromString(tex, new alphaTab.Settings());
const score = imp.readScore();
const voice = score.tracks[0].staves[0].bars[0].voices[0];

const msPerTick = (60000 / 72) / 960;

for (let i = 0; i < 2; i++) {
  const beat = voice.beats[i];
  const label = alphaTab.model.BrushType[beat.brushType];
  const totalMs = beat.brushDuration * msPerTick;
  console.log(`Beat ${i} (.16): ${label}, brushDuration=${beat.brushDuration} ticks = ${totalMs.toFixed(0)}ms`);
  // 16分音符 duration = 240 ticks, arpeggio durationFactor=1.0 → brushDuration = 240
  // 5弦, increment = 240/4 = 60 ticks = 52ms per string, total 208ms
}

// 对比 8 分音符
const tex8 = `\\tempo 72
\\instrument acousticguitarsteel
\\ts 4 4
.
(0.1 1.2 0.3 2.4 3.5).8 {ad} (0.1 1.2 0.3 2.4 3.5).8 {au} r.8 r.8 r.8 r.8 |`;

const imp8 = new alphaTab.importer.AlphaTexImporter();
imp8.initFromString(tex8, new alphaTab.Settings());
const score8 = imp8.readScore();
const voice8 = score8.tracks[0].staves[0].bars[0].voices[0];

for (let i = 0; i < 2; i++) {
  const beat = voice8.beats[i];
  const label = alphaTab.model.BrushType[beat.brushType];
  const totalMs = beat.brushDuration * msPerTick;
  console.log(`Beat ${i} (.8): ${label}, brushDuration=${beat.brushDuration} ticks = ${totalMs.toFixed(0)}ms`);
}
