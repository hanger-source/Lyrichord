/**
 * 测试多段落 @segment 引用展开 + pipeline
 */
import { expandSegmentRefs, tmdToAlphaTex } from '../src/core/pipeline';
import { genSectionBody, genChordDefs, genTmdHeader } from '../src/ui/components/tab/tab-tmd-gen';
import { mkMeasure } from '../src/ui/components/tab/tab-types';
import type { TabMeasure } from '../src/ui/components/tab/tab-types';

// 模拟两个段落的 measures
function makeMeasureWithChord(chordName: string, bpm: number): TabMeasure {
  const m = mkMeasure(bpm);
  m.chords.push({ fromBeat: 0, toBeat: 4, name: chordName });
  // 给第一个 beat 加个音符，让它有内容
  m.beats[0].strings[0] = { type: 'custom', fret: 0 };
  return m;
}

const introMeasures: TabMeasure[] = [makeMeasureWithChord('Em', 8)];
const aMeasures: TabMeasure[] = [makeMeasureWithChord('C', 8), makeMeasureWithChord('G', 8)];

// 模拟 genSectionBody 输出
const introResult = genSectionBody(introMeasures, '前奏');
const aResult = genSectionBody(aMeasures, 'A段');

console.log('=== 前奏 body ===');
console.log(introResult.body);
console.log('\n=== A段 body ===');
console.log(aResult.body);

// 模拟 resolver
const segmentDb: Record<string, { measures: TabMeasure[]; name: string }> = {
  '前奏': { measures: introMeasures, name: '前奏' },
  'A段': { measures: aMeasures, name: 'A段' },
};

function resolver(name: string): string | null {
  const seg = segmentDb[name];
  if (!seg) return null;
  const { body } = genSectionBody(seg.measures, seg.name);
  return body || null;
}

// 用户的 TMD 源码
const userTmd = `---
tempo: 76
time_signature: 4/4
---

# 前奏
@segment(前奏)

# A段
@segment(A段)
`;

console.log('\n=== 原始 TMD ===');
console.log(userTmd);

const expanded = expandSegmentRefs(userTmd, resolver);
console.log('\n=== 展开后 TMD ===');
console.log(expanded);

const result = tmdToAlphaTex(expanded);
console.log('\n=== Pipeline 结果 ===');
console.log('success:', result.success);
console.log('errors:', result.errors);
console.log('warnings:', result.warnings);
console.log('masterBars count:', result.song?.masterBars.length);
console.log('bars count:', result.song?.bars.length);

if (result.song) {
  for (let i = 0; i < result.song.masterBars.length; i++) {
    const mb = result.song.masterBars[i];
    console.log(`  masterBar[${i}]: section=${mb.section?.name ?? '(none)'}`);
  }
}

if (result.output) {
  console.log('\n=== AlphaTex 输出 ===');
  console.log(result.output.tex);
}
