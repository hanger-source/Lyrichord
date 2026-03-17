import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

function test(label: string, tmd: string) {
  const { tokens } = scan(tmd);
  const { song } = buildSong(tokens);
  const output = generate(song);
  const barLine = output.tex.split('\n').find(l => l.includes('|'))?.trim() ?? '';
  console.log(`\n=== ${label} ===`);
  console.log('Bars:', song.bars[0].beats.map(b => {
    const beats = (4/b.duration.base*(b.duration.dots?1.5:1)).toFixed(1);
    return `${b.chordId}(${beats}拍,rid=${b.rhythmId??'none'})`;
  }).join(', '));
  console.log('Tex:', barLine);
  const beatCount = barLine.split(' ').filter(t => /\.\d/.test(t)).length;
  console.log('Beat count:', beatCount);
}

const header = `---
tempo: 72
time_signature: 4/4
@R1: strum(D-DU-DUU)
@R2: strum(DUDU)
define [G]: { frets: "3 2 0 0 0 3" }
define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
define [A7]: { frets: "x 0 2 0 2 0" }
---
[A1]
`;

// 场景1: C@R1 占 2 拍, D@R1 占 2 拍
test('C@R1 . D@R1 . (各2拍)', header + '| C@R1 . D@R1 . |');

// 场景2: C@R1 占 4 拍（完整节奏型）
test('C@R1 . . . (4拍完整)', header + '| C@R1 . . . |');

// 场景3: G@R1 1拍, D@R1 1拍, A7@R1 2拍
test('G@R1 D@R1 A7@R1 . (1+1+2拍)', header + '| G@R1 D@R1 A7@R1 . |');

// 场景4: 3个和弦各1拍 + 延续
test('G@R1 C@R1 D@R1 . (1+1+1+1拍)', header + '| G@R1 C@R1 D@R1 . |');

// 场景5: 不同节奏型
test('C@R1 . D@R2 . (R1 2拍 + R2 2拍)', header + '| C@R1 . D@R2 . |');

// 场景6: R2(DUDU 4 slot) 各占 1 拍
test('G@R2 C@R2 D@R2 A7@R2 (各1拍)', header + '| G@R2 C@R2 D@R2 A7@R2 |');
