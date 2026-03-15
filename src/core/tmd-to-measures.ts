/**
 * TMD tex 行 → TabMeasure[] 转换器
 *
 * 解析 TMD 格式的 tex 行，还原为 TabEditor 的 measures 数据结构。
 */
import type { StringMark, Strings6, TabBeat, TabMeasure } from '../ui/components/TabEditor';

function emptyStrings(): Strings6 {
  return [
    { type: 'none' }, { type: 'none' }, { type: 'none' },
    { type: 'none' }, { type: 'none' }, { type: 'none' },
  ];
}

function durToWeight(dur: number): number {
  if (dur === 4) return 2;
  if (dur === 8) return 1;
  if (dur === 16) return 0.5;
  if (dur === 32) return 0.25;
  return 1;
}

/**
 * 解析单个 tex 行
 *
 * 支持: r.8, 3.1.8, (0.1 3.5).8, [C](0.1 3.5).8, [C]r.8, [C]3.1.8
 */
function parseTexLine(tex: string): TabMeasure {
  const beats: TabBeat[] = [];
  const chords: { fromBeat: number; toBeat: number; name: string }[] = [];

  const tokenRe = /(\[[^\]]+\])?\(([^)]+)\)\.(\d+)|(\[[^\]]+\])?(\d+)\.(\d+)\.(\d+)|(\[[^\]]+\])?r\.(\d+)/g;
  let match: RegExpExecArray | null;
  let beatIdx = 0;

  while ((match = tokenRe.exec(tex)) !== null) {
    const strings = emptyStrings();
    let weight: number;
    let rest = false;
    let chordName: string | null = null;

    if (match[3] !== undefined) {
      // 多音: [Chord?](notes).dur
      chordName = match[1] ? match[1].slice(1, -1) : null;
      const dur = parseInt(match[3], 10);
      weight = durToWeight(dur);
      const noteRe = /(\d+)\.(\d+)/g;
      let nm: RegExpExecArray | null;
      while ((nm = noteRe.exec(match[2])) !== null) {
        const fret = parseInt(nm[1], 10);
        const si = parseInt(nm[2], 10) - 1;
        if (si >= 0 && si < 6) strings[si] = { type: 'custom', fret };
      }
    } else if (match[7] !== undefined) {
      // 单音: [Chord?]fret.str.dur
      chordName = match[4] ? match[4].slice(1, -1) : null;
      const fret = parseInt(match[5], 10);
      const si = parseInt(match[6], 10) - 1;
      const dur = parseInt(match[7], 10);
      weight = durToWeight(dur);
      if (si >= 0 && si < 6) strings[si] = { type: 'custom', fret };
    } else {
      // 休止: [Chord?]r.dur
      chordName = match[8] ? match[8].slice(1, -1) : null;
      const dur = parseInt(match[9], 10);
      weight = durToWeight(dur);
      rest = true;
    }

    const beat: TabBeat = { strings, weight, group: 0 };
    if (rest) beat.rest = true;
    beats.push(beat);

    if (chordName) {
      chords.push({ fromBeat: beatIdx, toBeat: beatIdx + 1, name: chordName });
    }
    beatIdx++;
  }

  // 和弦区间延伸到下一个和弦或小节末尾
  for (let i = 0; i < chords.length; i++) {
    chords[i].toBeat = i + 1 < chords.length ? chords[i + 1].fromBeat : beats.length;
  }

  // 计算 group（基于累计 weight，每 2 weight 一组）
  let cumWeight = 0;
  for (const b of beats) {
    b.group = Math.floor(cumWeight / 2);
    cumWeight += b.weight;
  }

  return { beats, chords };
}

/**
 * 解析完整 TMD 文本为 TabMeasure[]
 */
export function parseTmdToMeasures(tmd: string): TabMeasure[] {
  const lines = tmd.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const measures: TabMeasure[] = [];

  for (const line of lines) {
    if (line.startsWith('tex:')) {
      measures.push(parseTexLine(line.slice(4).trim()));
    }
  }

  return measures;
}
