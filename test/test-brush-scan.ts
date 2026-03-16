/**
 * 验证 brush 标记在完整 pipeline 中的传递
 * 重点：scanner 是否正确把 {bd} 合并到 NOTE_EVENT
 */
import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

// 模拟 TabEditor 生成的 TMD（带 brush 标记）
const tmd = `---
tempo: 72
time_signature: 4/4
define [C]: { frets: "x 3 2 0 1 0" }
---

[Verse]

| C . . . |
tex: [C](0.1 1.2 0.3 2.4 3.5).16 {bd} r.16 r.16 r.16 (0.1 1.2 0.3 2.4 3.5).16 {bd} r.16 (0.1 1.2 0.3 2.4 3.5).16 {bd} (0.1 1.2 0.3 2.4 3.5).16 {bu} (0.1 0.2 0.3 0.4 0.5).16 {ds} (0.1 1.2 0.3 2.4 3.5).16 {bu} (0.1 1.2 0.3 2.4 3.5).16 {bd} (0.1 1.2 0.3 2.4 3.5).16 {bu} (0.1 1.2 0.3 2.4 3.5).16 {bd} r.16 (0.1 1.2 0.3 2.4 3.5).16 {bd} (0.1 1.2 0.3 2.4 3.5).16 {bu}
`;

const scanResult = scan(tmd);
console.log('Scanner errors:', scanResult.errors);

// 看 NOTE_EVENT tokens
const texTokens = scanResult.tokens.filter(t => t.type === 'NOTE_EVENT' || t.type === 'CHORD_MARK' || t.type === 'TEX_START');
console.log('\nTEX tokens:');
for (const t of texTokens) {
  if (t.type === 'NOTE_EVENT' && t.value.includes('{')) {
    console.log(`  ${t.type}: "${t.value}" ← 包含属性块`);
  }
}

const { song } = buildSong(scanResult.tokens);
const output = generate(song);

console.log('\n=== 最终 AlphaTex ===');
console.log(output.tex);

// 逐个 beat 检查
console.log('\n=== 逐 beat 检查 ===');
const beatPattern = /(\([^)]+\)\.\d+|\d+\.\d+\.\d+|r\.\d+)\s*(\{[^}]*\})?/g;
let match;
let idx = 0;
const texContent = output.tex.split('.')[1] || output.tex; // 取 . 分隔符后面的内容
while ((match = beatPattern.exec(output.tex)) !== null) {
  const beat = match[1];
  const props = match[2] || '(无属性)';
  if (beat.startsWith('(') || !beat.startsWith('r')) {
    console.log(`  beat ${idx}: ${beat} ${props}`);
  }
  idx++;
}
