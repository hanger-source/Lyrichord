import { scan } from '../src/core/parser/scanner';
import { buildSong } from '../src/core/parser/ast-builder';
import { generate } from '../src/core/generator/alphatex';

const tmd = `---
tempo: 72
time_signature: 4/4

@R1: strum(D-DU-DUU)

define [C]: { frets: "x 3 2 0 1 0" }
define [D]: { frets: "x x 0 2 3 2" }
define [G]: { frets: "3 2 0 0 0 3" }
define [A7]: { frets: "x 0 2 0 2 0" }
define [Em]: { frets: "0 2 2 0 0 0" }
---

[B段]

| C@R1 . D@R1 . |
| G@R1 . . . |
| C@R1 . D@R1 . |
| G@R1 . . . |
| C@R1 . D@R1 . |
| G@R1 D A7@R1 . |
| C@R1 . D@R1 . |
| Em@R1 . . . |
`;

const { tokens } = scan(tmd);
const { song, warnings } = buildSong(tokens);
if (warnings.length) console.log('Warnings:', warnings);

console.log('=== Bars summary ===');
for (let i = 0; i < song.bars.length; i++) {
  const bar = song.bars[i];
  const mb = song.masterBars[i];
  const desc = bar.beats.map(b => {
    const beats = (4/b.duration.base*(b.duration.dots?1.5:1));
    return `${b.chordId}(${beats}拍,rid=${b.rhythmId??'none'})`;
  }).join(' + ');
  console.log(`  M${i+1}: ${desc}`);
}

const output = generate(song);
console.log('\n=== Full AlphaTex ===');
console.log(output.tex);
