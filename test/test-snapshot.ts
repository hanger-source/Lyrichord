/**
 * 快照测试 — 固化当前正确的 scan → build → generate 输出
 *
 * 每个用例记录：
 *   1. TMD 输入
 *   2. 期望的 bar 结构（和弦、拍数、rhythmId）
 *   3. 期望的 ch 标记序列
 *   4. 期望的 AlphaTex 关键特征
 *
 * 跑法: npx tsx test/test-snapshot.ts
 * 全部通过输出 ✅，有失败输出 ❌ 并 exit 1
 */
import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`❌ ${label}${detail ? ': ' + detail : ''}`);
  }
}

function barSummary(song: ReturnType<typeof buildSong>['song']): string[] {
  return song.bars.map(bar =>
    bar.beats.map(b => {
      const beats = 4 / b.duration.base * (b.duration.dots ? 1.5 : 1);
      return `${b.chordId ?? '.'}(${beats},${b.rhythmId ?? '-'})`;
    }).join('+')
  );
}

function chMarkers(tex: string): string[] {
  return [...tex.matchAll(/ch "([^"]+)"/g)].map(m => m[1]);
}

function run(name: string, tmd: string, checks: (song: any, tex: string, bars: string[], chs: string[]) => void) {
  const { tokens } = scan(tmd);
  const { song } = buildSong(tokens);
  const { tex } = generate(song);
  const bars = barSummary(song);
  const chs = chMarkers(tex);
  console.log(`\n── ${name} ──`);
  checks(song, tex, bars, chs);
}

// ============================================================
// 用例 1: 单区间 4 拍 — | C@S8-vih8g . D . |
// C@S8-vih8g 开始一个 4 拍区间，D 在区间内切换和弦（不带 @S8-vih8g）
// ============================================================
run('1: C@S8-vih8g . D . (单区间4拍)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---
[A1]
| C@S8-vih8g . D . |
`, (song, tex, bars, chs) => {
  // bar 结构: C 2拍 rid=S8-vih8g, D 2拍 rid=none（继承区间）
  assert('bar结构', bars[0] === 'C(2,S8-vih8g)+D(2,-)', bars[0]);
  // ch 标记: C 和 D 各一次
  assert('ch标记', chs.join(',') === 'C,D', chs.join(','));
  // 时值: 4拍区间 8slot → 八分音符基准 (.4 和 .8)
  assert('八分音符基准', tex.includes('.4') && tex.includes('.8'));
  assert('不含十六分', !tex.includes('.16'));
});

// ============================================================
// 用例 2: 两个独立区间 — | C@S8-vih8g . D@S8-vih8g . |
// 两个 @S8-vih8g 区间各 2 拍
// ============================================================
run('2: C@S8-vih8g . D@S8-vih8g . (两个2拍区间)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---
[A1]
| C@S8-vih8g . D@S8-vih8g . |
`, (song, tex, bars, chs) => {
  // bar 结构: C 2拍 rid=S8-vih8g, D 2拍 rid=S8-vih8g
  assert('bar结构', bars[0] === 'C(2,S8-vih8g)+D(2,S8-vih8g)', bars[0]);
  // ch 标记: C 和 D 各一次
  assert('ch标记', chs.join(',') === 'C,D', chs.join(','));
  // 时值: 2拍区间 8slot → 十六分音符基准
  assert('含十六分', tex.includes('.16'));
});

// ============================================================
// 用例 3: 区间内和弦切换 — | G@S8-vih8g D A7@S8-vih8g . |
// 区间1: G+D 共 2 拍，区间2: A7 共 2 拍
// ============================================================
run('3: G@S8-vih8g D A7@S8-vih8g . (区间内切换)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
define [G]: { frets: "3 2 0 0 0 3" }
define [D]: { frets: "x x 0 2 3 2" }
define [A7]: { frets: "x 0 2 0 2 0" }
---
[A1]
| G@S8-vih8g D A7@S8-vih8g . |
`, (song, tex, bars, chs) => {
  // bar 结构: G 1拍 rid=S8-vih8g, D 1拍 rid=none, A7 2拍 rid=S8-vih8g
  assert('bar结构', bars[0] === 'G(1,S8-vih8g)+D(1,-)+A7(2,S8-vih8g)', bars[0]);
  // ch 标记: G → D → A7（三次切换）
  assert('ch标记', chs.join(',') === 'G,D,A7', chs.join(','));
  // 密度和用例2一致（2拍区间）
  assert('含十六分', tex.includes('.16'));
});

// ============================================================
// 用例 4: 不同节奏型 — | C@S8-vih8g . D@S8-1eifm . |
// ============================================================
run('4: C@S8-vih8g . D@S8-1eifm . (不同节奏型)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
@S8-1eifm: strum(DUDU-DUU)
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---
[A1]
| C@S8-vih8g . D@S8-1eifm . |
`, (song, tex, bars, chs) => {
  assert('bar结构', bars[0] === 'C(2,S8-vih8g)+D(2,S8-1eifm)', bars[0]);
  assert('ch标记', chs.join(',') === 'C,D', chs.join(','));
});

// ============================================================
// 用例 5: TEX 直通模式 — 不受节奏型影响
// ============================================================
run('5: TEX直通模式', `---
tempo: 72
time_signature: 4/4
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---
[A1]
| C . D . |
tex: [C]3.5.8 0.3.8 (0.1 1.2).8 0.3.8 [D]0.4.8 2.3.8 (2.1 3.2).8 2.3.8
`, (song, tex, bars, chs) => {
  // tex 模式: _rawTex 存在
  const hasRawTex = song.bars[0].beats.some((b: any) => b._rawTex);
  assert('有_rawTex', hasRawTex);
  // ch 标记: C 和 D
  assert('ch标记', chs.join(',') === 'C,D', chs.join(','));
  // 原始 tex 内容保留
  assert('包含3.5.8', tex.includes('3.5.8'));
});

// ============================================================
// 用例 6: 完整 B 段 — 多小节 ch 标记去重
// ============================================================
run('6: 完整B段(ch去重)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
define [G]: { frets: "3 2 0 0 0 3" }
define [A7]: { frets: "x 0 2 0 2 0" }
define [Em]: { frets: "0 2 2 0 0 0" }
---
[B段]
| C@S8-vih8g . D@S8-vih8g . |
| G@S8-vih8g . . . |
| C@S8-vih8g . D@S8-vih8g . |
| G@S8-vih8g . . . |
| C@S8-vih8g . D@S8-vih8g . |
| G@S8-vih8g D A7@S8-vih8g . |
| C@S8-vih8g . D@S8-vih8g . |
| Em@S8-vih8g . . . |
`, (song, tex, bars, chs) => {
  // M6 结构
  assert('M6结构', bars[5] === 'G(1,S8-vih8g)+D(1,-)+A7(2,S8-vih8g)', bars[5]);
  // ch 标记序列: 每次和弦切换都有，同和弦连续不重复
  const expected = 'C,D,G,C,D,G,C,D,G,D,A7,C,D,Em';
  assert('ch序列', chs.join(',') === expected, chs.join(','));
  // 8 个小节
  assert('8小节', song.bars.length === 8, String(song.bars.length));
});

// ============================================================
// 用例 7: brush 属性 — TEX 直通 {bd} {bu} {ds}
// ============================================================
run('7: brush属性(bd/bu/ds)', `---
tempo: 72
time_signature: 4/4
define [C]: { frets: "x 3 2 0 1 0" }
---
[Verse]
| C . . . |
tex: [C](0.1 1.2 0.3 2.4 3.5).8 {bd} r.8 (0.1 1.2 0.3 2.4 3.5).8 {bu} (0.1 0.2 0.3 0.4 0.5).8 {ds} r.8 (0.1 1.2 0.3 2.4 3.5).8 {bu} (0.1 1.2 0.3 2.4 3.5).8 {bd} (0.1 1.2 0.3 2.4 3.5).8 {bu}
`, (song, tex, bars, chs) => {
  assert('包含bd', tex.includes('{bd'));
  assert('包含bu', tex.includes('{bu'));
  assert('包含ds', tex.includes('{ds'));
  // 不能有双 {} 块
  assert('无双{}块', !tex.match(/\{[^}]+\}\s*\{/));
});

// ============================================================
// 用例 8: 单和弦整小节 — | G@S8-vih8g . . . |
// ============================================================
run('8: G@S8-vih8g . . . (单和弦4拍)', `---
tempo: 72
time_signature: 4/4
@S8-vih8g: strum(D-DU-DUU)
define [G]: { frets: "3 2 0 0 0 3" }
---
[A1]
| G@S8-vih8g . . . |
`, (song, tex, bars, chs) => {
  assert('bar结构', bars[0] === 'G(4,S8-vih8g)', bars[0]);
  assert('ch标记只有G', chs.join(',') === 'G', chs.join(','));
  // 4拍区间 → 八分音符基准
  assert('八分音符基准', tex.includes('.4') && tex.includes('.8'));
  assert('不含十六分', !tex.includes('.16'));
});

// ============================================================
// 结果汇总
// ============================================================
console.log(`\n${'='.repeat(40)}`);
if (failed === 0) {
  console.log(`✅ 全部通过 (${passed} 项)`);
} else {
  console.log(`❌ ${failed} 项失败, ${passed} 项通过`);
  process.exit(1);
}
