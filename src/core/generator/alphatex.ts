/**
 * AlphaTex 生成器 v7
 *
 * Song → AlphaTexOutput
 *
 * 两种小节模式:
 *   1. TEX 直通: beat._rawTex 存在 → 直接输出原始 AlphaTex beat 文本
 *   2. 节奏型展开: 用 chordSlots + rhythmPattern 生成 beat 序列
 *
 * 歌词: 使用 AlphaTab 的 \lyrics staff-level 指令
 *   格式: \lyrics "word1 word2 - word3 ..."
 *   空格分隔对应每个 beat，"-" 表示延续
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

    // Section 标记
    if (mb.section) {
      barLines.push(`\\section "${mb.section.name}"`);
    }

    barLines.push(measureTex + ' |');

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

    if (beat.chordId) {
      // 在 beat 前加和弦标记
      parts.push(`${rawTex} {ch "${beat.chordId}"}`);
    } else {
      parts.push(rawTex);
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


// ============================================================
// 节奏型展开生成
// ============================================================

function slotBeats(rhythm: RhythmPattern): number {
  return rhythm.type === 'pluck' ? 0.5 : 0.25;
}

function generateMeasure(
  rhythm: RhythmPattern | null,
  timeline: MeasureTimeline,
  beatsPerMeasure: number,
): string {
  if (!rhythm || rhythm.slots.length === 0) {
    return generateFallbackMeasure(timeline, beatsPerMeasure);
  }

  const bps = slotBeats(rhythm);
  const slotCount = rhythm.slots.length;
  const totalSlots = Math.round(beatsPerMeasure / bps);

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
    if (ev.chordId) props.push(`ch "${ev.chordId}"`);

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
    if (slot.action === 'down') return { notes: all, brush: 'bd' };
    if (slot.action === 'up') return { notes: all, brush: 'bu' };
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
