/**
 * AlphaTex 生成器 v7
 *
 * Song → AlphaTexOutput
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 核心数据流                                                   │
 * │                                                             │
 * │  TMD Text ──scan()──▶ Token[]                               │
 * │           ──buildSong()──▶ Song { masterBars, bars, ... }   │
 * │           ──generate()──▶ AlphaTexOutput { tex, measures }  │
 * │                                                             │
 * │  AlphaTex 文本最终传给 AlphaTab 的 api.tex(tex) 进行渲染/播放  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 两种小节模式:
 *   1. TEX 直通: beat._rawTex 存在 → 直接输出原始 AlphaTex beat 文本
 *      用于 TAB 编辑器手写的精确音符（如前奏指弹）
 *   2. 节奏型展开: 用 chordSlots + rhythmPattern 生成 beat 序列
 *      用于弹唱段落（和弦 + 节奏型自动展开）
 *
 * AlphaTex 语法参考:
 *   音符: fret.string (如 3.6 = 6弦3品)
 *   多音: (3.6 2.5 0.4)
 *   时值: .4 = 四分音符, .8 = 八分, .16 = 十六分
 *   Beat 属性: {ad 60} = brush down, {au 60} = brush up, {ds} = dead stroke
 *   Note 属性: {lr} = let ring, {pm} = palm mute, {x} = dead note
 *   和弦标记: {ch "Am"} → 谱面显示和弦名
 *   段落标记: \section "前奏" → 谱面显示段落名
 *
 * 歌词: 使用 AlphaTab 的 \lyrics staff-level 指令
 *   格式: \lyrics "word1 word2 - word3 ..."
 *   空格分隔对应每个 beat，"-" 表示延续
 *
 * 延音效果:
 *   let ring 不在此处生成（避免 AlphaTex 文本膨胀），
 *   而是在 ScorePane.tsx 的 scoreLoaded 回调里统一注入 note.isLetRing = true。
 *   谱面上的 let ring 虚线标记通过 effectLetRing: false 隐藏。
 */
import type {
  Song, Bar, Beat, RhythmPattern, GuitarFrets,
  AlphaTexOutput, GeneratedMeasure,
  DurationValue, Dynamic, Note, RhythmSlot,
} from '../types';
import {
  Duration, durationToAlphaTex, durationToBeats, beatsToDuration,
} from '../types';
import { resolveChord } from '../chord/resolver';
import { notesToAlphaTex } from '../chord/voicing';
import { dynamicToAlphaTex } from './dynamics';

export function generate(song: Song): AlphaTexOutput {
  const measures: GeneratedMeasure[] = [];
  const headerLines: string[] = [];
  const barLines: string[] = [];

  // ---- Header metadata ----
  if (song.meta.title) headerLines.push(`\\title "${song.meta.title}"`);
  if (song.meta.artist) headerLines.push(`\\subtitle "${song.meta.artist}"`);
  headerLines.push(`\\tempo ${song.meta.tempo}`);
  headerLines.push(`\\instrument acousticguitarsteel`);
  if (song.meta.capo > 0) headerLines.push(`\\capo ${song.meta.capo}`);
  const ts = song.meta.timeSignature;
  headerLines.push(`\\ts ${ts.numerator} ${ts.denominator}`);

  const beatsPerMeasure = ts.numerator * (4 / ts.denominator);

  let activeRhythmId: string | null = null;
  let lastChordFrets: GuitarFrets | null = null;
  let lastChordId: string | null = null;

  // ---- 收集所有歌词用于 \lyrics 指令 ----
  const allLyricWords: string[] = [];
  const allLyric2Words: string[] = [];

  for (let i = 0; i < song.masterBars.length; i++) {
    const mb = song.masterBars[i];
    const bar = song.bars[i];
    if (!bar) continue;

    if (mb.rhythmId) activeRhythmId = mb.rhythmId;

    const rhythm = activeRhythmId
      ? song.rhythmLibrary.get(activeRhythmId) ?? null
      : null;

    // 检查是否是 tex 直通模式
    const isTexMode = bar.beats.some(b => (b as any)._rawTex);

    // Section 标记
    const sectionTex = mb.section ? `\\section "${mb.section.name}" ` : '';

    let measureTex: string;
    let measureLyrics = '';
    let measureLyrics2 = '';

    if (isTexMode) {
      // TEX 直通模式
      measureTex = generateTexPassthrough(bar, song, lastChordId, lastChordFrets);
      // 更新 lastChord
      for (const beat of bar.beats) {
        if (beat.chordId) {
          lastChordId = beat.chordId;
          const frets = resolveFrets(beat.chordId, song);
          if (frets) lastChordFrets = frets;
        }
      }
    } else {
      // 节奏型展开模式
      const timeline = buildTimeline(bar, song, lastChordId, lastChordFrets);
      if (timeline.endChordId) lastChordId = timeline.endChordId;
      if (timeline.endFrets) lastChordFrets = timeline.endFrets;

      measureTex = generateMeasure(rhythm, timeline, beatsPerMeasure);

      // 收集歌词
      for (const beat of bar.beats) {
        if (beat.lyrics && beat.lyrics !== '~') {
          measureLyrics += beat.lyrics;
        }
        const w2 = (beat as any)._lyrics2;
        if (w2 && w2 !== '~') {
          measureLyrics2 += w2;
        }
      }
    }

    barLines.push(sectionTex + measureTex + ' |');

    measures.push({
      notes: measureTex,
      lyrics: measureLyrics || undefined,
    });

    // 收集歌词 words (每个 beat 对应一个 word)
    if (!isTexMode) {
      for (const beat of bar.beats) {
        const ly = beat.lyrics;
        if (ly && ly !== '~') {
          allLyricWords.push(ly);
        } else {
          allLyricWords.push('-');
        }
        const w2 = (beat as any)._lyrics2;
        if (w2 && w2 !== '~') {
          allLyric2Words.push(w2);
        } else {
          allLyric2Words.push('-');
        }
      }
    } else {
      // tex 模式的 beat 不产生歌词
      for (const _beat of bar.beats) {
        allLyricWords.push('-');
        allLyric2Words.push('-');
      }
    }
  }

  // ---- 组装最终 AlphaTex ----
  const lines = [...headerLines];

  // ── \chord 指令 — 和弦指法图 ────────────────────────────
  // 收集所有用到的和弦，用 \chord 语法定义指法数据。
  // AlphaTab 会在谱面开头渲染指法图（showDiagram=true）。
  // 格式: \chord "Am" 1弦 2弦 3弦 4弦 5弦 6弦
  //   AlphaTab 参数顺序: 1弦(高E) → 6弦(低E)，与 GuitarFrets 相反
  //   -1=不弹, 0=空弦, N=品位(绝对)
  const chordsSeen = new Set<string>();
  for (const bar of song.bars) {
    if (!bar) continue;
    for (const beat of bar.beats) {
      if (beat.chordId && !chordsSeen.has(beat.chordId)) {
        chordsSeen.add(beat.chordId);
        const frets = resolveFrets(beat.chordId, song);
        if (frets) {
          // AlphaTab \chord 参数顺序: 1弦(高E) → 6弦(低E)
          // GuitarFrets 索引顺序: [0]=6弦(低E) → [5]=1弦(高E)
          // 所以需要反转数组
          const reversed = [...frets].reverse();
          const fretsStr = reversed.map(f => f < 0 ? -1 : f).join(' ');
          lines.push(`\\chord "${beat.chordId}" ${fretsStr}`);
        }
      }
    }
  }

  // 歌词指令 (如果有非空歌词)
  const hasLyrics = allLyricWords.some(w => w !== '-');
  if (hasLyrics) {
    const lyricsStr = allLyricWords.join(' ');
    lines.push(`\\lyrics "${lyricsStr}"`);
  }

  lines.push('.');  // 分隔符

  lines.push(...barLines);

  return { tex: lines.join('\n'), measures };
}


// ============================================================
// TEX 直通模式
// ============================================================

/**
 * 直接输出 bar 中的 _rawTex beat 文本
 * 和弦标记用 {ch "X"} 属性
 */
function generateTexPassthrough(
  bar: Bar, song: Song,
  inheritedChordId: string | null,
  inheritedFrets: GuitarFrets | null,
): string {
  const parts: string[] = [];

  for (const beat of bar.beats) {
    const rawTex = (beat as any)._rawTex as string | undefined;
    if (!rawTex) continue;

    // 从 _rawTex 中提取已有的 {props} 块，分离出纯 beat 文本和属性
    const propsMatch = rawTex.match(/^(.*?)\s*\{([^}]*)\}\s*$/);
    let beatText: string;
    const existingProps: string[] = [];

    if (propsMatch) {
      beatText = propsMatch[1].trim();
      existingProps.push(propsMatch[2].trim());
    } else {
      beatText = rawTex;
    }

    // 添加和弦属性
    if (beat.chordId) {
      existingProps.push(`ch "${beat.chordId}"`);
    }

    if (existingProps.length > 0) {
      parts.push(`${beatText} {${existingProps.join(' ')}}`);
    } else {
      parts.push(beatText);
    }
  }

  return parts.join(' ');
}


// ============================================================
// Timeline: 从模板 beats 提取和弦变化点 + 歌词位置
// ============================================================

interface ChordChange {
  beatPos: number;
  chordId: string;
  frets: GuitarFrets;
}

interface LyricsAt {
  beatPos: number;
  text: string;
}

interface MeasureTimeline {
  chordChanges: ChordChange[];
  lyrics: LyricsAt[];
  inheritedFrets: GuitarFrets | null;
  endChordId: string | null;
  endFrets: GuitarFrets | null;
}

function buildTimeline(
  bar: Bar, song: Song,
  inheritedChordId: string | null,
  inheritedFrets: GuitarFrets | null,
): MeasureTimeline {
  const chordChanges: ChordChange[] = [];
  const lyrics: LyricsAt[] = [];
  let currentChordId = inheritedChordId;
  let currentFrets = inheritedFrets;
  let beatPos = 0;

  for (const beat of bar.beats) {
    const dur = durationToBeats(beat.duration);

    if (beat.chordId) {
      const frets = resolveFrets(beat.chordId, song);
      if (frets) {
        chordChanges.push({ beatPos, chordId: beat.chordId, frets });
        currentChordId = beat.chordId;
        currentFrets = frets;
      }
    }

    if (beat.lyrics) {
      lyrics.push({ beatPos, text: beat.lyrics });
    }

    beatPos += dur;
  }

  return {
    chordChanges,
    lyrics,
    inheritedFrets,
    endChordId: currentChordId,
    endFrets: currentFrets,
  };
}

function resolveFrets(chordId: string, song: Song): GuitarFrets | null {
  const fromLib = song.chordLibrary.get(chordId);
  if (fromLib) return fromLib.frets;
  const resolved = resolveChord(chordId);
  return resolved ? resolved.frets : null;
}


/**
 * 节奏型展开生成
 *
 * 核心算法:
 *   1. 遍历 rhythm.slots，按 beatPos 匹配 timeline 中的和弦变化点
 *   2. 和弦变化时重置 patIdx（节奏型从头开始）
 *   3. 合并连续 sustain slot 到前一个 event 的 slotSpan
 *   4. 每个 event 转换为 AlphaTex beat 文本
 *
 * 时值计算: slotBeats = beatsPerMeasure / slots.length
 *   例: 4/4 拍 + 16 slots → 每 slot = 0.25 拍 = 十六分音符
 */

/**
 * 每个 slot 占多少拍。
 * 节奏型统一代表一整小节，slot 时值 = 小节总拍数 / slot 数量。
 */
function slotBeats(rhythm: RhythmPattern, beatsPerMeasure: number): number {
  return beatsPerMeasure / rhythm.slots.length;
}

function generateMeasure(
  rhythm: RhythmPattern | null,
  timeline: MeasureTimeline,
  beatsPerMeasure: number,
): string {
  if (!rhythm || rhythm.slots.length === 0) {
    return generateFallbackMeasure(timeline, beatsPerMeasure);
  }

  const bps = slotBeats(rhythm, beatsPerMeasure);
  const slotCount = rhythm.slots.length;
  const totalSlots = slotCount; // 一小节 = 一轮完整节奏型

  interface SlotInfo {
    beatPos: number;
    slot: RhythmSlot;
    frets: GuitarFrets | null;
    chordId: string | null;
  }

  const slots: SlotInfo[] = [];
  let patIdx = 0;
  let currentFrets = timeline.inheritedFrets;
  let currentChordId: string | null = null;
  let chordChangeIdx = 0;

  for (let i = 0; i < totalSlots; i++) {
    const beatPos = i * bps;

    let newChord = false;
    while (chordChangeIdx < timeline.chordChanges.length &&
           timeline.chordChanges[chordChangeIdx].beatPos <= beatPos + 0.001) {
      const cc = timeline.chordChanges[chordChangeIdx];
      currentFrets = cc.frets;
      currentChordId = cc.chordId;
      newChord = true;
      chordChangeIdx++;
    }

    if (newChord) patIdx = 0;

    slots.push({
      beatPos,
      slot: rhythm.slots[patIdx % slotCount],
      frets: currentFrets,
      chordId: newChord ? currentChordId : null,
    });

    patIdx++;
  }

  // 合并 sustain
  interface MergedEvent {
    beatPos: number;
    slot: RhythmSlot;
    frets: GuitarFrets | null;
    chordId: string | null;
    slotSpan: number;
  }

  const events: MergedEvent[] = [];
  for (const s of slots) {
    const isSustain = s.slot.kind === 'strum' && s.slot.action === 'sustain';
    if (isSustain && events.length > 0) {
      events[events.length - 1].slotSpan++;
    } else {
      events.push({ ...s, slotSpan: 1 });
    }
  }

  const parts: string[] = [];

  for (const ev of events) {
    const eventBeats = ev.slotSpan * bps;
    const durVal = beatsToDuration(eventBeats);
    const durStr = durationToAlphaTex(durVal);

    const props: string[] = [];
    if (ev.chordId) {
      props.push(`ch "${ev.chordId}"`);
    }

    if (!ev.frets) {
      const propsStr = wrapProps(props);
      parts.push(propsStr ? `r.${durStr} ${propsStr}` : `r.${durStr}`);
    } else {
      const { notes, brush } = slotToNotes(ev.slot, ev.frets);
      if (notes.length === 0) {
        const propsStr = wrapProps(props);
        parts.push(propsStr ? `r.${durStr} ${propsStr}` : `r.${durStr}`);
      } else {
        const noteTex = notesToAlphaTex(notes);
        const allProps = brush
          ? wrapProps([brush, ...props])
          : wrapProps(props);
        parts.push(allProps
          ? `${noteTex}.${durStr} ${allProps}`
          : `${noteTex}.${durStr}`);
      }
    }
  }

  return parts.join(' ');
}

function generateFallbackMeasure(
  timeline: MeasureTimeline,
  beatsPerMeasure: number,
): string {
  const beatCount = Math.round(beatsPerMeasure);
  const dur = beatsToDuration(beatsPerMeasure / beatCount);
  const durStr = durationToAlphaTex(dur);
  const parts: string[] = [];

  for (let bi = 0; bi < beatCount; bi++) {
    const beatPos = bi * (beatsPerMeasure / beatCount);
    const frets = getChordAtBeat(beatPos, timeline);
    const props: string[] = [];
    const cc = findChordChangeAt(beatPos, beatsPerMeasure / beatCount, timeline);
    if (cc) props.push(`ch "${cc.chordId}"`);

    if (!frets) {
      const propsStr = wrapProps(props);
      parts.push(propsStr ? `r.${durStr} ${propsStr}` : `r.${durStr}`);
      continue;
    }

    const root = findRootNote(frets);
    const noteTex = notesToAlphaTex([root]);
    const propsStr = wrapProps(props);
    parts.push(propsStr ? `${noteTex}.${durStr} ${propsStr}` : `${noteTex}.${durStr}`);
  }

  return parts.join(' ');
}


// ============================================================
// Slot → Notes
// ============================================================

/**
 * Slot → Notes 转换
 *
 * 将节奏型的单个 slot 转换为 AlphaTex 音符列表。
 *
 * slot.kind:
 *   'pluck' → 拨弦: target='root' 只弹根音, 否则按 strings[] 指定弦
 *   'strum' → 扫弦:
 *     action='down'    → 下扫 {ad 60}
 *     action='up'      → 上扫 {au 60}
 *     action='mute'    → 闷音 {ds} (dead stroke)
 *     action='sustain' → 延续前一个音（合并到前一个 event 的时值里）
 *
 * frets: GuitarFrets = number[6]，索引 0=1弦(高E) 5=6弦(低E)
 * 弦号约定: string 6=低E, string 1=高E (AlphaTab 标准)
 * 索引转换: idx = 6 - string
 */
function slotToNotes(
  slot: RhythmSlot,
  frets: GuitarFrets,
): { notes: Note[]; brush?: string } {
  if (slot.kind === 'pluck') {
    if (slot.target === 'root') {
      return { notes: [findRootNote(frets)] };
    }
    const notes: Note[] = [];
    for (const s of slot.strings) {
      const idx = 6 - s;
      if (idx >= 0 && idx < frets.length && frets[idx] >= 0) {
        notes.push({ string: s, fret: frets[idx] });
      }
    }
    return { notes: notes.length > 0 ? notes : [findRootNote(frets)] };
  }

  if (slot.kind === 'strum') {
    if (slot.action === 'sustain') return { notes: [] };
    const all = getAllPlayable(frets);
    // brush duration (弦间延迟): 下扫 60ms, 上扫 50ms
    // 上扫比下扫快 10ms — 模拟真实手腕回弹 vs 重力顺势的速度差异
    // 调参历史: 默认→120ms(太慢)→40ms(太像拨)→60/50ms(当前)
    // 注意: 与 tab-tmd-gen.ts 的 brush duration 保持同步
    if (slot.action === 'down') return { notes: all, brush: 'ad 60' };
    if (slot.action === 'up') return { notes: all, brush: 'au 50' };
    // ds (dead stroke) 不接受 duration 参数 — AlphaTab 会报 AT220
    if (slot.action === 'mute') return { notes: all, brush: 'ds' };
    return { notes: all };
  }

  return { notes: [findRootNote(frets)] };
}

// ============================================================
// 查找辅助
// ============================================================

function getChordAtBeat(beatPos: number, timeline: MeasureTimeline): GuitarFrets | null {
  let found: GuitarFrets | null = null;
  for (const cc of timeline.chordChanges) {
    if (cc.beatPos <= beatPos + 0.001) found = cc.frets;
  }
  return found ?? timeline.inheritedFrets;
}

function findChordChangeAt(
  beatPos: number, slotDuration: number, timeline: MeasureTimeline,
): ChordChange | null {
  for (const cc of timeline.chordChanges) {
    if (cc.beatPos >= beatPos - 0.001 && cc.beatPos < beatPos + slotDuration - 0.001) return cc;
  }
  return null;
}

// ============================================================
// 工具函数
// ============================================================

function findRootNote(frets: GuitarFrets): Note {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return { string: 6 - i, fret: frets[i] };
  }
  return { string: 6, fret: 0 };
}

function getAllPlayable(frets: GuitarFrets): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) notes.push({ string: 6 - i, fret: frets[i] });
  }
  return notes;
}

function wrapProps(props: string[]): string {
  return props.length > 0 ? `{${props.join(' ')}}` : '';
}
