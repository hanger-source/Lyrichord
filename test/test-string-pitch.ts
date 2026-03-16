/**
 * 验证 string 编号反转是否影响实际音高
 * 
 * 我们的约定: si=0 是 e弦(高音), str=si+1=1
 * AlphaTex: string 1 = E弦(低音)
 * 
 * 所以 0.1 在我们的意思是 "e弦空弦(E4=64)"
 * 但 AlphaTex 解析成 "E弦空弦(E2=40)"
 */
import * as alphaTab from '@coderline/alphatab';

// 场景: C和弦 标准指法 x32010
// 我们的 frets 数组 (从高到低): [0, 1, 0, 2, 3, -1]
// si=0(e弦) fret=0 → str=1 → AlphaTex "0.1"
// si=1(B弦) fret=1 → str=2 → AlphaTex "1.2"  
// si=2(G弦) fret=0 → str=3 → AlphaTex "0.3"
// si=3(D弦) fret=2 → str=4 → AlphaTex "2.4"
// si=4(A弦) fret=3 → str=5 → AlphaTex "3.5"
// si=5(E弦) fret=-1 → 不弹

// 但 AlphaTex string 1 = E弦(低音)，所以:
// "0.1" 被解析为 E弦(低音) fret 0 = E2(40) ← 错！应该是 e弦(高音) fret 0 = E4(64)
// "1.2" 被解析为 A弦 fret 1 = Bb2(46) ← 错！应该是 B弦 fret 1 = C4(61)

// 正确的 AlphaTex 应该是:
// e弦(高音) = string 6 → "0.6"
// B弦 = string 5 → "1.5"
// G弦 = string 4 → "0.4"
// D弦 = string 3 → "2.3"
// A弦 = string 2 → "3.2"

const texWrong = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.1 1.2 0.3 2.4 3.5).1 |`;
const texRight = `\\tempo 72\n\\instrument acousticguitarsteel\n\\ts 4 4\n.\n(0.6 1.5 0.4 2.3 3.2).1 |`;

function analyze(label: string, tex: string) {
  console.log(`\n=== ${label} ===`);
  const s = new alphaTab.Settings();
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, s);
  const score = imp.readScore();
  const tuning = score.tracks[0].staves[0].tuning;
  const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
  for (const n of beat.notes) {
    const tuningNote = tuning[n.string - 1];
    const realValue = tuningNote + n.fret;
    console.log(`  string=${n.string}, fret=${n.fret}, tuning=${tuningNote}, realValue=${realValue} (MIDI)`);
  }
}

analyze('当前(错误?) string编号', texWrong);
analyze('翻转后(正确?) string编号', texRight);

// C和弦正确音高应该是:
// e弦 fret 0 = E4 = MIDI 64
// B弦 fret 1 = C4 = MIDI 61  
// G弦 fret 0 = G3 = MIDI 55
// D弦 fret 2 = E3 = MIDI 52
// A弦 fret 3 = C3 = MIDI 48
console.log('\nC和弦正确音高: 64, 61, 55, 52, 48');
