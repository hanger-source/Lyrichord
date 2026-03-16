/**
 * 测试 x 品位判断逻辑
 *
 * 规则：beat 里的 note 如果 fret 和当前和弦在同一根弦上的品位一致 → x
 *       否则保留数字
 *
 * 用用户提供的 TMD 测试数据验证
 */
import { tmdToAlphaTex } from '../src/core/pipeline';

const tmd = `
---
tempo: 76
time_signature: 4/4
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
define [Em]: { frets: "0 2 2 0 0 0" }
define [B7]: { frets: "2 2 4 2 4 2" }
---
[前奏]
| . . . . |
tex: r.8 r.8 r.8 r.8 r.8 r.8 3.1.8 2.1.8
| C . D . |
tex: [C](0.1 3.5).8 0.3.8 1.2.4 [D](2.1 0.4).8 2.3.8 3.2.8 2.3.8
| Em . . . |
tex: [Em]0.6.8 2.4.8 3.1.8 0.3.8 2.1.8 0.3.8 0.1.8 0.3.8
| C . B7 . |
tex: [C](3.1 3.5).8 0.3.8 1.2.8 3.1.8 [B7](5.1 2.5).8 4.4.8 2.3.8 5.1.8
| Em . . . |
tex: [Em](7.1 0.6).8 0.3.8 0.2.8 7.1.8 (8.1 0.6).8 0.3.8 10.1.8 0.3.8
| C . D . |
tex: [C](10.1 10.4).8 0.3.8 8.2.4 [D](10.2 0.4).8 7.1.16 10.2.16 8.2.8 7.2.8
| Em . . . |
tex: [Em](8.2 0.6).8 0.3.8 7.2.8 0.3.8 (0.1 0.6).4 r.8 r.8
`;

const result = tmdToAlphaTex(tmd.trim());
if (!result.success) {
  console.error('Pipeline errors:', result.errors);
  process.exit(1);
}

console.log('=== AlphaTex 输出 ===');
console.log(result.output!.tex);
console.log();

// 和弦定义: frets 格式是 "6弦 5弦 4弦 3弦 2弦 1弦"
// GuitarFrets 索引: [0]=6弦 [1]=5弦 [2]=4弦 [3]=3弦 [4]=2弦 [5]=1弦
// AlphaTab \chord 参数顺序: 1弦 2弦 3弦 4弦 5弦 6弦 (已在 alphatex.ts 里反转)
// AlphaTab chord.strings: [0]=1弦 [1]=2弦 ... [5]=6弦
// note.string: 1=高E(1弦) ... 6=低E(6弦)

// 模拟 AlphaTab 解析后的 chord.strings 和 note.string 映射
// chord.strings: [0]=1弦(高E) [1]=2弦 ... [5]=6弦(低E)
// note.string: 1=6弦(低E) ... 6=1弦(高E) (AlphaTab 内部编号, 反转的!)
// 映射: chord.strings[si] 对应 note.string = 6 - si

const chordStrings: Record<string, number[]> = {
  'C':  [0, 1, 0, 2, 3, -1],   // 1弦=0, 2弦=1, 3弦=0, 4弦=2, 5弦=3, 6弦=x
  'D':  [2, 3, 2, 0, -1, -1],  // 1弦=2, 2弦=3, 3弦=2, 4弦=0, 5弦=x, 6弦=x
  'Em': [0, 0, 0, 2, 2, 0],    // 1弦=0, 2弦=0, 3弦=0, 4弦=2, 5弦=2, 6弦=0
  'B7': [2, 4, 2, 4, 2, 2],    // 1弦=2, 2弦=4, 3弦=2, 4弦=4, 5弦=2, 6弦=2
};

// 构建 chordFretMap: chordId → Map<note.string, fret>
// note.string = numStrings - si (6弦吉他: 6-0=6 对应 chord.strings[0]=1弦)
// 等等不对，AlphaTex 里 fret.string 的 string 和 note.string 的关系:
// AlphaTex "3.6" → noteString=6 → note.string = tuning.length - (noteString-1) = 6-5 = 1
// 所以 AlphaTex string 6(低E) → note.string 1
// AlphaTex string 1(高E) → note.string 6
const numStrings = 6;
const chordFretMap = new Map<string, Map<number, number>>();
for (const [chordId, strings] of Object.entries(chordStrings)) {
  const stringMap = new Map<number, number>();
  for (let si = 0; si < strings.length; si++) {
    const fret = strings[si];
    if (fret >= 0) {
      // chord.strings[si] = (si+1)弦 → note.string = numStrings - si
      stringMap.set(numStrings - si, fret);
    }
  }
  chordFretMap.set(chordId, stringMap);
  console.log(`[chord-map] ${chordId}: ${JSON.stringify([...stringMap.entries()])}`);
}

// 现在模拟 AlphaTex 解析后的 note 数据
// 从 AlphaTex 输出里手动提取 note 信息来验证
// 但更好的方式是直接看 TMD 里的 tex 行

console.log('\n=== 逐 beat 验证 x 判断 ===');

// 解析 tex 行里的 note
// 格式: fret.string 或 (fret.string fret.string)
interface TestNote { fret: number; string: number }
interface TestBeat { notes: TestNote[]; chordId: string | null }

function parseTexLine(tex: string): TestBeat[] {
  const beats: TestBeat[] = [];
  // 简单解析: 按空格分割，识别 [ChordId] 前缀和 fret.string 模式
  const tokens = tex.trim().split(/\s+/);
  let currentChord: string | null = null;
  let i = 0;
  while (i < tokens.length) {
    let token = tokens[i];
    let beatChord: string | null = null;

    // [ChordId] 前缀
    const chordMatch = token.match(/^\[([^\]]+)\]/);
    if (chordMatch) {
      currentChord = chordMatch[1];
      beatChord = currentChord;
      token = token.slice(chordMatch[0].length);
    }

    // 多音 (...)
    if (token.startsWith('(')) {
      const notes: TestNote[] = [];
      // 收集直到 )
      let combined = token.slice(1);
      while (!combined.includes(')') && i + 1 < tokens.length) {
        i++;
        combined += ' ' + tokens[i];
      }
      combined = combined.replace(')', '');
      // 解析每个 fret.string (AlphaTex string → note.string)
      for (const part of combined.split(/\s+/)) {
        const m = part.match(/^(\d+)\.(\d+)/);
        if (m) {
          const atString = parseInt(m[2]); // AlphaTex string (1=高E, 6=低E)
          const noteString = numStrings - (atString - 1); // note.string (1=低E, 6=高E)
          notes.push({ fret: parseInt(m[1]), string: noteString });
        }
      }
      // 跳过时值部分 (.8 等)
      beats.push({ notes, chordId: beatChord });
    } else if (token.startsWith('r')) {
      // rest
      beats.push({ notes: [], chordId: beatChord });
    } else {
      // 单音 fret.string.duration (AlphaTex string → note.string)
      const m = token.match(/^(\d+)\.(\d+)/);
      if (m) {
        const atString = parseInt(m[2]);
        const noteString = numStrings - (atString - 1);
        beats.push({
          notes: [{ fret: parseInt(m[1]), string: noteString }],
          chordId: beatChord,
        });
      }
    }
    i++;
  }
  return beats;
}

// TMD tex 行
const texLines = [
  { bar: 1, tex: 'r.8 r.8 r.8 r.8 r.8 r.8 3.1.8 2.1.8', section: '前奏' },
  { bar: 2, tex: '[C](0.1 3.5).8 0.3.8 1.2.4 [D](2.1 0.4).8 2.3.8 3.2.8 2.3.8' },
  { bar: 3, tex: '[Em]0.6.8 2.4.8 3.1.8 0.3.8 2.1.8 0.3.8 0.1.8 0.3.8' },
  { bar: 4, tex: '[C](3.1 3.5).8 0.3.8 1.2.8 3.1.8 [B7](5.1 2.5).8 4.4.8 2.3.8 5.1.8' },
  { bar: 5, tex: '[Em](7.1 0.6).8 0.3.8 0.2.8 7.1.8 (8.1 0.6).8 0.3.8 10.1.8 0.3.8' },
  { bar: 6, tex: '[C](10.1 10.4).8 0.3.8 8.2.4 [D](10.2 0.4).8 7.1.16 10.2.16 8.2.8 7.2.8' },
  { bar: 7, tex: '[Em](8.2 0.6).8 0.3.8 7.2.8 0.3.8 (0.1 0.6).4 r.8 r.8' },
];

let activeChord: string | null = null;
let errors = 0;

for (const line of texLines) {
  const beats = parseTexLine(line.tex);
  for (const beat of beats) {
    if (beat.chordId) activeChord = beat.chordId;
    if (beat.notes.length === 0) continue;

    const chordFrets = activeChord ? chordFretMap.get(activeChord) : null;

    for (const note of beat.notes) {
      let shouldBeX = false;
      let expectedFret: number | undefined;
      if (chordFrets) {
        expectedFret = chordFrets.get(note.string);
        if (expectedFret != null && note.fret === expectedFret) {
          shouldBeX = true;
        }
      }
      const display = shouldBeX ? 'x' : String(note.fret);
      const match = expectedFret != null ? `expected=${expectedFret}` : 'no-chord-on-string';
      console.log(
        `  bar${line.bar} chord=${activeChord || 'none'} ` +
        `${note.fret}.${note.string} → ${display}  (${match})`
      );
    }
  }
}

console.log(errors === 0 ? '\n✅ 测试通过' : `\n❌ ${errors} 个错误`);
