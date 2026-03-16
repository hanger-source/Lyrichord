/**
 * 端到端测试：brush 标记从 mToTex → scanner → ast-builder → generate → AlphaTex
 * 验证 {bd}/{bu}/{ds} 不会导致 AlphaTab 解析错误
 */
import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

// 模拟一个带 brush 标记的 TMD
const tmd = `---
tempo: 72
time_signature: 4/4
define [C]: { frets: "x 3 2 0 1 0" }
---

[Verse]

| C . . . |
tex: [C](0.1 1.2 0.3 2.4 3.5).8 {bd} r.8 (0.1 1.2 0.3 2.4 3.5).8 {bu} (0.1 0.2 0.3 0.4 0.5).8 {ds} r.8 (0.1 1.2 0.3 2.4 3.5).8 {bu} (0.1 1.2 0.3 2.4 3.5).8 {bd} (0.1 1.2 0.3 2.4 3.5).8 {bu}
`;

console.log('=== 输入 TMD ===');
console.log(tmd);

const scanResult = scan(tmd);
if (scanResult.errors.length > 0) {
  console.log('Scanner errors:', scanResult.errors);
}

console.log('\n=== Scanner tokens (tex 相关) ===');
for (const t of scanResult.tokens) {
  if (t.type === 'TEX_START' || t.type === 'NOTE_EVENT' || t.type === 'CHORD_MARK') {
    console.log(`  ${t.type}: "${t.value}"`);
  }
}

const song = buildSong(scanResult.tokens);
console.log('\n=== Song bars ===');
for (let i = 0; i < song.song.bars.length; i++) {
  const bar = song.song.bars[i];
  console.log(`Bar ${i}: ${bar.beats.length} beats`);
  for (const beat of bar.beats) {
    const raw = (beat as any)._rawTex;
    console.log(`  _rawTex: "${raw}", chordId: ${beat.chordId ?? 'none'}`);
  }
}

const output = generate(song.song);
console.log('\n=== 生成的 AlphaTex ===');
console.log(output.tex);

// 检查是否包含 {bd} {ch "C"} 这种双属性块（应该合并成一个）
const hasDualBraces = /\{[^}]+\}\s*\{[^}]+\}/.test(output.tex);
console.log(`\n双属性块检查: ${hasDualBraces ? '❌ 存在双 {} 块' : '✅ 无双 {} 块'}`);

// 检查 {bd}, {bu}, {ds} 是否保留
console.log(`包含 bd: ${output.tex.includes('bd')}`);
console.log(`包含 bu: ${output.tex.includes('bu')}`);
console.log(`包含 ds: ${output.tex.includes('ds')}`);
