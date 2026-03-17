/**
 * 测试 | C@R1 . D . | 的完整 scan → build → generate 流程
 */
import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

const tmd = `---
tempo: 72
time_signature: 4/4

@R1: strum(D-DU-DUU)

define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---

[A1]

| C@R1 . D . |
`;

const { tokens, errors: scanErrors } = scan(tmd);
console.log('=== Scan Errors ===', scanErrors);

const { song, warnings } = buildSong(tokens);
console.log('=== Build Warnings ===', warnings);
console.log('=== MasterBars ===', JSON.stringify(song.masterBars, null, 2));
console.log('=== Bars ===', JSON.stringify(song.bars, null, 2));
console.log('=== RhythmLibrary ===');
for (const [k, v] of song.rhythmLibrary) {
  console.log(`  ${k}:`, JSON.stringify(v));
}

const output = generate(song);
console.log('\n=== Generated AlphaTex ===');
console.log(output.tex);

// 也测试没有节奏型的版本
const tmd2 = `---
tempo: 72
time_signature: 4/4

define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---

[A1]

| C . D . |
tex: [C]3.5.8 0.3.8 (0.1 1.2).8 0.3.8 [D]0.4.8 2.3.8 (2.1 3.2).8 2.3.8
`;

const r2 = scan(tmd2);
const s2 = buildSong(r2.tokens);
const o2 = generate(s2.song);
console.log('\n=== Without rhythm (tex mode) ===');
console.log(o2.tex);

// 测试3: 两个和弦都标 R1
const tmd3 = `---
tempo: 72
time_signature: 4/4

@R1: strum(D-DU-DUU)

define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---

[A1]

| C@R1 . D@R1 . |
`;

const r3 = scan(tmd3);
const s3 = buildSong(r3.tokens);
const o3 = generate(s3.song);
console.log('\n=== Both C@R1 D@R1 ===');
console.log(o3.tex);
console.log('=== Bars ===', JSON.stringify(s3.song.bars, null, 2));

// 测试4: 不同节奏型 C@R1 D@R2
const tmd4 = `---
tempo: 72
time_signature: 4/4

@R1: strum(D-DU-DUU)
@R2: strum(DUDU-DUU)

define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
---

[A1]

| C@R1 . D@R2 . |
`;

const r4 = scan(tmd4);
const s4 = buildSong(r4.tokens);
const o4 = generate(s4.song);
console.log('\n=== C@R1 D@R2 (different rhythms) ===');
console.log(o4.tex);
console.log('=== Bars ===', JSON.stringify(s4.song.bars, null, 2));


// 测试5: 区间内和弦切换 | G@R1 D A7@R1 . |
// G@R1 开始区间1（G+D 共 2 拍），A7@R1 开始区间2（2 拍）
const tmd5 = `---
tempo: 72
time_signature: 4/4

@R1: strum(D-DU-DUU)

define [G]: { frets: "3 2 0 0 0 3" }
define [D]: { frets: "x x 0 2 3 2" }
define [A7]: { frets: "x 0 2 0 2 0" }
---

[A1]

| G@R1 D A7@R1 . |
`;

const r5 = scan(tmd5);
const s5 = buildSong(r5.tokens);
console.log('\n=== Region test: G@R1 D A7@R1 . ===');
console.log('Beat summary:');
for (const b of s5.song.bars[0].beats) {
  const beats = (4 / b.duration.base * (b.duration.dots ? 1.5 : 1));
  console.log(`  ${b.chordId ?? '(none)'}  ${beats}拍  rid=${b.rhythmId ?? 'none'}`);
}
const o5 = generate(s5.song);
console.log(o5.tex);
