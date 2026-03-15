/**
 * AlphaTex 生成器 v3
 *
 * Song → AlphaTexOutput
 *
 * 核心逻辑:
 * 1. 遍历 masterBars + bars (1:1 对应)
 * 2. rhythmId 继承: MasterBar.rhythmId 设置后持续生效直到下一个
 * 3. chordId 继承: Beat.chordId 设置后持续生效直到下一个
 * 4. 每个 Beat 根据 chordId → frets + rhythmSlots → NoteEvents → AlphaTex
 */
import type {
  Song, Bar, RhythmPattern, GuitarFrets,
  AlphaTexOutput, GeneratedMeasure,
  DurationValue, Dynamic,
} from '../types';
import { durationToAlphaTex, durationToBeats, beatsToDuration } from '../types';
import { resolveChord } from '../chord/resolver';
import { notesToAlphaTex } from '../chord/voicing';
import { expandRhythm, type NoteEvent } from '../rhythm/expander';
import { dynamicToAlphaTex } from './dynamics';

/**
 * 从 Song 生成完整 AlphaTex
 */
export function generate(song: Song): AlphaTexOutput {
  const measures: GeneratedMeasure[] = [];
  const lines: string[] = [];

  // ---- 头部 ----
  if (song.meta.title) lines.push(`\\title "${song.meta.title}"`);
  if (song.meta.artist) lines.push(`\\subtitle "${song.meta.artist}"`);
  lines.push(`\\tempo ${song.meta.tempo}`);
  lines.push(`\\instrument acousticguitarsteel`);
  if (song.meta.capo > 0) lines.push(`\\capo ${song.meta.capo}`);
  const ts = song.meta.timeSignature;
  lines.push(`\\ts ${ts.numerator} ${ts.denominator}`);
  lines.push('.');

  // ---- 状态跟踪 ----
  let activeRhythmId: string | null = null;
  let activeDynamic: Dynamic | null = null;
  let lastFrets: GuitarFrets | null = null;

  // ---- 遍历小节 ----
  for (let i = 0; i < song.masterBars.length; i++) {
    const mb = song.masterBars[i];
    const bar = song.bars[i];
    if (!bar) continue;

    // 更新继承状态
    if (mb.rhythmId) activeRhythmId = mb.rhythmId;
    if (mb.dynamic) activeDynamic = mb.dynamic;

    // 段落首小节力度（仅使用显式设置的 mb.dynamic）
    let measureDynamic: Dynamic | null = null;
    if (mb.dynamic && mb.dynamic !== activeDynamic) {
      measureDynamic = mb.dynamic;
    }

    // 查找当前节奏型
    const rhythm = activeRhythmId
      ? song.rhythmLibrary.get(activeRhythmId) ?? null
      : null;

    // 获取当前拍号
    const currentTs = mb.timeSignature ?? song.meta.timeSignature;

    // 生成小节内容
    const measureTex = generateBar(bar, rhythm, currentTs, song, lastFrets);

    // 更新 lastFrets (取小节最后一个有效和弦)
    for (const beat of bar.beats) {
      if (beat.chordId) {
        const resolved = resolveChord(beat.chordId);
        if (resolved) lastFrets = resolved.frets;
      }
    }

    // 力度前缀
    let prefix = '';
    if (measureDynamic) {
      prefix = dynamicToAlphaTex(measureDynamic) + ' ';
    }

    measures.push({
      notes: measureTex,
      lyrics: bar.beats.map(b => b.lyrics ?? '').join(''),
      dynamic: activeDynamic ?? undefined,
    });

    lines.push(prefix + measureTex + ' |');
  }

  return { tex: lines.join('\n'), measures };
}


/**
 * 生成单个小节的 AlphaTex
 */
function generateBar(
  bar: Bar,
  rhythm: RhythmPattern | null,
  ts: { numerator: number; denominator: number },
  song: Song,
  inheritedFrets: GuitarFrets | null,
): string {
  const parts: string[] = [];
  let lastFrets: GuitarFrets | null = inheritedFrets;
  let beatOffset = 0;

  for (const beat of bar.beats) {
    const beatBeats = durationToBeats(beat.duration);

    if (beat.isRest) {
      parts.push(`r.${durationToAlphaTex(beat.duration)}`);
      beatOffset += beatBeats;
      continue;
    }

    // 确定当前 frets
    let frets: GuitarFrets | null = null;
    if (beat.chordId) {
      // 先查 song.chordLibrary (用户自定义)，再查内置库
      const fromLib = song.chordLibrary.get(beat.chordId);
      if (fromLib) {
        frets = fromLib.frets;
      } else {
        const resolved = resolveChord(beat.chordId);
        if (resolved) frets = resolved.frets;
      }
      if (frets) lastFrets = frets;
    } else {
      // 延续上一个和弦
      frets = lastFrets;
    }

    if (!frets) {
      // 无和弦可用 → 休止
      parts.push(`r.${durationToAlphaTex(beat.duration)}`);
      beatOffset += beatBeats;
      continue;
    }

    // 有节奏型 → 展开
    if (rhythm && rhythm.slots.length > 0) {
      parts.push(generateBeatWithRhythm(frets, rhythm, beatBeats, ts, beatOffset));
    } else {
      // 无节奏型 → 简单和弦
      parts.push(generateSimpleChord(frets, beat.duration));
    }

    beatOffset += beatBeats;
  }

  return parts.join(' ');
}

/**
 * 在一个 Beat 的时值内展开节奏型
 *
 * 节奏型是为完整小节设计的。每个 beat 根据在小节中的位置截取对应 slot 区间。
 */
function generateBeatWithRhythm(
  frets: GuitarFrets,
  rhythm: RhythmPattern,
  beatDuration: number,
  ts: { numerator: number; denominator: number },
  beatOffset: number,
): string {
  const totalSlots = rhythm.slots.length;
  const totalBeats = ts.numerator;
  const beatsPerSlot = totalBeats / totalSlots;

  // 当前 beat 使用多少 slot
  let slotsForBeat = Math.round(beatDuration / beatsPerSlot);
  slotsForBeat = Math.max(1, Math.min(slotsForBeat, totalSlots));

  // slot 起始偏移
  let slotOffset = Math.round(beatOffset / beatsPerSlot);
  slotOffset = Math.max(0, Math.min(slotOffset, totalSlots - 1));

  // 不越界
  if (slotOffset + slotsForBeat > totalSlots) {
    slotsForBeat = totalSlots - slotOffset;
  }

  const slicedSlots = rhythm.slots.slice(slotOffset, slotOffset + slotsForBeat);
  const events = expandRhythm(rhythm.type, slicedSlots, frets);

  // slot 时值
  const slotDur = beatsToDuration(beatsPerSlot);

  return eventsToAlphaTex(events, slotDur);
}

/**
 * NoteEvent[] → AlphaTex
 */
function eventsToAlphaTex(events: NoteEvent[], duration: DurationValue): string {
  const parts: string[] = [];
  const durStr = durationToAlphaTex(duration);
  parts.push(`:${durStr}`);

  let lastNoteTex: string | null = null;

  for (const event of events) {
    if (event.isRest) {
      parts.push('r');
      lastNoteTex = null;
      continue;
    }
    if (event.isSustain) {
      if (lastNoteTex) {
        parts.push(`${lastNoteTex} {t}`);
      } else {
        parts.push('r');
      }
      continue;
    }
    const noteTex = notesToAlphaTex(event.notes);
    lastNoteTex = noteTex;
    if (event.isDeadNote) {
      parts.push(`${noteTex} {x}`);
    } else if (event.brushDirection) {
      const brush = event.brushDirection === 'down' ? '{bd}' : '{bu}';
      parts.push(`${noteTex} ${brush}`);
    } else {
      parts.push(noteTex);
    }
  }

  return parts.join(' ');
}

/**
 * 简单和弦（无节奏型 fallback）
 */
function generateSimpleChord(frets: GuitarFrets, dur: DurationValue): string {
  const notes: string[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) {
      notes.push(`${frets[i]}.${6 - i}`);
    }
  }
  const durStr = durationToAlphaTex(dur);
  if (notes.length === 0) return `r.${durStr}`;
  return `(${notes.join(' ')}).${durStr} {bd}`;
}
