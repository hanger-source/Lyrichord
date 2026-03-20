/**
 * AST 构建器 v4 — 产出 Song 模型
 *
 * Token[] → Song
 *
 * v4 token 流结构 (每个小节):
 *   BAR_LINE → CHORD_BEAT/NOTE_EVENT → BAR_LINE   (小节行)
 *   然后可能跟:
 *     CHORD_MARK + LYRICS ...                      (w: 歌词行)
 *     W2_START + CHORD_MARK + LYRICS ...           (w2: 第二段歌词)
 *     TEX_START + CHORD_MARK + NOTE_EVENT ...      (tex: 精确 beat)
 *
 * 小节行定义和弦结构和拍数分配:
 *   | C . D . |  → C 占 2 拍, D 占 2 拍
 *
 * 歌词行 (w:) 的 [X] 标记和弦入点，文字是歌词
 * TEX 行 (tex:) 的 [X] 标记和弦入点，NOTE_EVENT 是精确 AlphaTex beat
 *
 * 生成策略:
 *   有 tex: → Bar.beats 直接从 tex beat 构建 (精确模式)
 *   有 w:   → Bar.beats 留空，由 generator 用节奏型展开 (模板模式)
 *   两者都没有 → 同模板模式，无歌词
 */
import type {
  Token, Song, SongMeta, MasterBar, Bar, Beat,
  RhythmPattern, RhythmType, TimeSignature,
  ChordDefinition, GuitarFrets, DurationValue, Note,
} from '../types';
import { Duration, beatsToDuration } from '../types';
import { parsePattern } from '../rhythm/pattern-parser';

export interface BuildResult {
  song: Song;
  warnings: BuildWarning[];
}

export interface BuildWarning {
  message: string;
  line: number;
}

/**
 * 小节行解析出的和弦-拍位结构
 * | C . D . | → [{chord:'C', beats:2}, {chord:'D', beats:2}]
 * | C@R1 . D . | → [{chord:'C', beats:2, rhythmId:'R1'}, {chord:'D', beats:2}]
 */
interface MeasureChordSlot {
  chord: string | null;  // null = 延续上一个和弦 (不应该出现在第一个位置)
  beats: number;         // 占几拍
  rhythmId?: string;     // 和弦级别节奏型引用
}

/** 一个完整小节的收集结果 */
interface CollectedMeasure {
  /** 小节行的和弦-拍位结构 */
  chordSlots: MeasureChordSlot[];
  /** w: 歌词行 tokens (CHORD_MARK + LYRICS 交替) */
  lyricsTokens: Token[];
  /** w2: 第二段歌词 tokens */
  lyrics2Tokens: Token[];
  /** tex: 行 tokens (CHORD_MARK + NOTE_EVENT 交替) */
  texTokens: Token[];
  /** 是否有 tex 行 */
  hasTex: boolean;
  /** 来源行号 (用于 warning) */
  lineNum: number;
}

export function buildSong(tokens: Token[]): BuildResult {
  const warnings: BuildWarning[] = [];
  const meta: SongMeta = {
    tempo: 72,
    timeSignature: { numerator: 4, denominator: 4 },
    capo: 0,
  };
  const rhythmLibrary = new Map<string, RhythmPattern>();
  const chordLibrary = new Map<string, ChordDefinition>();
  const masterBars: MasterBar[] = [];
  const bars: Bar[] = [];

  let pendingMetaKey: string | null = null;
  let currentSection: string | null = null;
  let currentRhythmId: string | null = null;
  let lastFlushedSection: string | null = null;

  // 收集当前小节
  let inMeasure = false;
  let measureSlots: MeasureChordSlot[] = [];
  let currentMeasureLineNum = 0;

  // 小节后的附属行 (w: / w2: / tex:) 缓冲
  let pendingLyrics: Token[] = [];
  let pendingLyrics2: Token[] = [];
  let pendingTex: Token[] = [];
  let hasPendingTex = false;
  let collectingW2 = false;
  let collectingTex = false;

  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti];

    switch (t.type) {
      // ---- Header ----
      case 'HEADER_START':
      case 'HEADER_END':
        break;
      case 'META_KEY':
        pendingMetaKey = t.value.toLowerCase();
        break;
      case 'META_VALUE':
        if (pendingMetaKey) { applyMeta(meta, pendingMetaKey, t.value); pendingMetaKey = null; }
        break;
      case 'RHYTHM_DEF':
        parseRhythmDef(t.value, t.line, rhythmLibrary, warnings);
        break;
      case 'CHORD_DEF':
        parseChordDef(t.value, t.line, chordLibrary, warnings);
        break;

      // ---- Body ----
      case 'SECTION':
        flushMeasure();
        currentSection = t.value;
        break;
      case 'RHYTHM_REF':
        // 段落级引用 (紧跟 SECTION) 或和弦级引用 (小节行内)
        if (inMeasure) {
          // 小节行内的 @R1 — 附着到最近的 chordSlot（和弦级别）
          const rid = t.value.replace(/^@/, '').trim();
          if (measureSlots.length > 0) {
            measureSlots[measureSlots.length - 1].rhythmId = rid;
          }
        } else {
          currentRhythmId = t.value.replace(/^@/, '').trim();
        }
        break;

      case 'BAR_LINE':
        if (inMeasure) {
          // 遇到第二个 | → 小节行结束
          inMeasure = false;
          // 不 flush，等附属行
        } else {
          // 遇到第一个 | → 新小节开始
          flushMeasure(); // flush 上一个小节
          inMeasure = true;
          measureSlots = [];
          currentMeasureLineNum = t.line;
          collectingW2 = false;
          collectingTex = false;
        }
        break;

      case 'CHORD_BEAT':
        if (inMeasure) {
          measureSlots.push({ chord: t.value, beats: 1 });
        }
        break;

      case 'NOTE_EVENT':
        if (inMeasure && t.value === '.') {
          // 延续拍 — 增加上一个 slot 的拍数
          if (measureSlots.length > 0) {
            measureSlots[measureSlots.length - 1].beats++;
          }
        } else if (collectingTex) {
          pendingTex.push(t);
        }
        break;

      case 'W2_START':
        collectingW2 = true;
        collectingTex = false;
        break;

      case 'TEX_START':
        collectingTex = true;
        collectingW2 = false;
        hasPendingTex = true;
        break;

      case 'CHORD_MARK':
        if (collectingTex) {
          pendingTex.push(t);
        } else if (collectingW2) {
          pendingLyrics2.push(t);
        } else {
          // w: 歌词行的和弦标记
          pendingLyrics.push(t);
        }
        break;

      case 'LYRICS':
        if (collectingW2) {
          pendingLyrics2.push(t);
        } else {
          pendingLyrics.push(t);
        }
        break;

      case 'NEWLINE':
        // 换行 → 结束当前附属行的收集模式
        collectingW2 = false;
        collectingTex = false;
        break;

      case 'COMMENT':
        break;
    }
  }

  flushMeasure();

  return { song: { meta, masterBars, bars, rhythmLibrary, chordLibrary }, warnings };

  // ---- flush 一个完整小节 ----
  function flushMeasure() {
    if (measureSlots.length === 0 && !hasPendingTex) {
      // 没有小节内容，清空缓冲
      pendingLyrics = [];
      pendingLyrics2 = [];
      pendingTex = [];
      hasPendingTex = false;
      return;
    }

    const collected: CollectedMeasure = {
      chordSlots: measureSlots,
      lyricsTokens: pendingLyrics,
      lyrics2Tokens: pendingLyrics2,
      texTokens: pendingTex,
      hasTex: hasPendingTex,
      lineNum: currentMeasureLineNum,
    };

    const idx = masterBars.length;
    const mb: MasterBar = { index: idx };

    if (currentSection && currentSection !== lastFlushedSection) {
      mb.section = { name: currentSection };
      lastFlushedSection = currentSection;
    }

    // mb.rhythmId 只用于段落级引用（[Section] 后的 @R1）
    // 和弦级别的 rhythmId 已经存在每个 beat 上，不提升到 mb
    mb.rhythmId = currentRhythmId ?? undefined;

    masterBars.push(mb);

    const bar = buildBar(collected, idx, meta.timeSignature, warnings);
    bars.push(bar);

    // 清空缓冲
    measureSlots = [];
    pendingLyrics = [];
    pendingLyrics2 = [];
    pendingTex = [];
    hasPendingTex = false;
  }
}

// ============================================================
// 构建 Bar
// ============================================================

/**
 * 从收集的小节数据构建 Bar
 *
 * 两种模式:
 *   1. tex 模式: texTokens → 精确 Beat[]
 *   2. 模板模式: chordSlots → Beat[] (每个 slot = 一个 beat，和弦标记)
 *      歌词附着在 beat 上
 */
function buildBar(
  collected: CollectedMeasure,
  masterBarIndex: number,
  ts: TimeSignature,
  warnings: BuildWarning[],
): Bar {
  if (collected.hasTex) {
    return buildTexBar(collected, masterBarIndex, warnings);
  }
  return buildTemplateBar(collected, masterBarIndex, ts, warnings);
}

/**
 * TEX 模式: 精确 AlphaTex beat
 *
 * texTokens 序列: CHORD_MARK, NOTE_EVENT, NOTE_EVENT, CHORD_MARK, NOTE_EVENT ...
 * 每个 NOTE_EVENT 的 value 就是原始 AlphaTex beat 文本 (如 "3.5.8", "(0.1 0.2).8", "r.4")
 *
 * 我们把它们存为 Beat，notes 为空，但在 beat 上标记 rawTex 供 generator 直通输出
 */
function buildTexBar(
  collected: CollectedMeasure,
  masterBarIndex: number,
  warnings: BuildWarning[],
): Bar {
  const beats: Beat[] = [];
  let currentChord: string | undefined;

  for (const t of collected.texTokens) {
    if (t.type === 'CHORD_MARK') {
      currentChord = t.value;
      continue;
    }
    if (t.type === 'NOTE_EVENT') {
      // 解析时值 — 从 beat 文本末尾提取 duration
      const dur = parseTexBeatDuration(t.value);
      const beat: Beat = {
        duration: dur,
        notes: [],
        isRest: t.value.startsWith('r'),
        chordId: currentChord,
      };
      // 存原始 tex 文本到 lyrics 字段 (临时复用，generator 会识别)
      // 更好的方案: 扩展 Beat 类型加 rawTex 字段
      // 但为了最小改动，用 playback.letRing 之外的方式标记
      // 实际上我们直接在 beat 上加一个 _rawTex 属性
      (beat as any)._rawTex = t.value;
      beats.push(beat);
      currentChord = undefined; // 和弦只标记一次
    }
  }

  return { masterBarIndex, beats };
}

/**
 * 从 AlphaTex beat 文本解析时值
 * "3.5.8" → Eighth
 * "(0.1 0.2).8" → Eighth
 * "r.4" → Quarter
 * "3.5.4{d}" → Quarter dotted
 */
function parseTexBeatDuration(text: string): DurationValue {
  // 去掉括号内容，找最后的 .数字
  let s = text;
  // 处理 (xxx).dur 格式
  const parenMatch = s.match(/\)\.\s*(\d+)/);
  if (parenMatch) {
    return parseDurNum(parseInt(parenMatch[1], 10), s.includes('{d}'));
  }
  // 处理 r.dur 格式
  const restMatch = s.match(/^r\.(\d+)/);
  if (restMatch) {
    return parseDurNum(parseInt(restMatch[1], 10), s.includes('{d}'));
  }
  // 处理 fret.string.dur 格式
  const parts = s.replace(/\{[^}]*\}/g, '').split('.');
  if (parts.length >= 3) {
    const durNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(durNum)) {
      return parseDurNum(durNum, s.includes('{d}'));
    }
  }
  // fallback
  return { base: Duration.Eighth, dots: 0 };
}

function parseDurNum(num: number, dotted: boolean): DurationValue {
  const base = [1, 2, 4, 8, 16, 32].includes(num) ? num as Duration : Duration.Eighth;
  return { base, dots: dotted ? 1 : 0 };
}

/**
 * 模板模式: 和弦 slot → Beat[]
 *
 * 每个 chordSlot 产生一个 Beat，标记 chordId 和拍数
 * 歌词从 lyricsTokens 按 CHORD_MARK 对齐到对应的 beat
 */
function buildTemplateBar(
  collected: CollectedMeasure,
  masterBarIndex: number,
  ts: TimeSignature,
  warnings: BuildWarning[],
): Bar {
  const beats: Beat[] = [];

  // 小节行 token 数量 = 拍号拍数（严格 1:1）
  // | C . D . | → 4 token = 4/4 拍的 4 拍
  // 每个 token 占 1 拍，. 延续前一个和弦
  // 如果 token 数量不匹配拍号，在 validator 层报 warning
  const beatsPerMeasure = ts.numerator * (4 / ts.denominator);
  const ticksPerBeat = 960; // 四分音符 = 960 ticks (MIDI 标准 PPQ)
  let tickPos = 0;

  for (const slot of collected.chordSlots) {
    // 每个 slot 的 beats 字段 = 连续 token 数（含 . 延续拍）
    // 直接映射为实际拍数，不做比例缩放
    const slotTicks = slot.beats * ticksPerBeat;
    const dur = beatsToDuration(slot.beats);
    const beat: Beat = {
      duration: dur,
      notes: [],
      isRest: false,
      chordId: slot.chord ?? undefined,
      rhythmId: slot.rhythmId,
      tick: tickPos,
    };
    beats.push(beat);
    tickPos += slotTicks;
  }

  // 对齐歌词: lyricsTokens 里的 CHORD_MARK 对应 beat 的 chordId
  attachLyrics(beats, collected.lyricsTokens, false);
  attachLyrics(beats, collected.lyrics2Tokens, true);

  return { masterBarIndex, beats };
}

/**
 * 将歌词 tokens 附着到 beats 上
 *
 * 歌词行: [C]约会像是为分[D]享到饱肚
 * tokens: CHORD_MARK("C"), LYRICS("约会像是为分"), CHORD_MARK("D"), LYRICS("享到饱肚")
 *
 * 匹配逻辑: CHORD_MARK 的值匹配 beat 的 chordId，后面的 LYRICS 附着到该 beat
 */
function attachLyrics(beats: Beat[], tokens: Token[], isW2: boolean): void {
  if (tokens.length === 0) return;

  let currentBeatIdx = -1;
  let currentChord: string | null = null;

  for (const t of tokens) {
    if (t.type === 'CHORD_MARK') {
      currentChord = t.value;
      // 找到对应的 beat
      currentBeatIdx = beats.findIndex(b => b.chordId === currentChord);
      continue;
    }
    if (t.type === 'LYRICS') {
      if (currentBeatIdx >= 0 && currentBeatIdx < beats.length) {
        const beat = beats[currentBeatIdx];
        if (isW2) {
          // w2 歌词存到 playback 的临时字段
          (beat as any)._lyrics2 = ((beat as any)._lyrics2 || '') + t.value;
        } else {
          beat.lyrics = (beat.lyrics || '') + t.value;
        }
      }
    }
  }
}

// ============================================================
// Meta
// ============================================================

function applyMeta(meta: SongMeta, key: string, value: string): void {
  switch (key) {
    case 'title': meta.title = stripQuotes(value); break;
    case 'author': case 'artist': meta.artist = stripQuotes(value); break;
    case 'tempo': case 'bpm': meta.tempo = parseInt(value, 10) || 72; break;
    case 'time_signature': case 'time': {
      const m = value.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) meta.timeSignature = { numerator: +m[1], denominator: +m[2] };
      break;
    }
    case 'capo': meta.capo = parseInt(value, 10) || 0; break;
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

// ============================================================
// Rhythm definition
// ============================================================

function parseRhythmDef(
  line: string, lineNum: number,
  lib: Map<string, RhythmPattern>, warnings: BuildWarning[]
): void {
  const m = line.match(/^@([\w-]+)\s*:\s*(pluck|strum)\s*\(\s*(.+)\s*\)\s*$/i);
  if (!m) {
    const simple = line.match(/^@([\w-]+)\s*:\s*(.+)/);
    if (simple) {
      const id = simple[1];
      const raw = simple[2].trim();
      const type: RhythmType = /[DUX]/i.test(raw) && !/^p/i.test(raw) ? 'strum' : 'pluck';
      lib.set(id, { id, type, raw, slots: parsePattern(raw, type) });
      return;
    }
    warnings.push({ message: `无法解析节奏型: "${line}"`, line: lineNum });
    return;
  }
  const id = m[1];
  const type = m[2].toLowerCase() as RhythmType;
  const rawFull = m[3].trim();
  const parts = rawFull.split(',');
  const raw = parts[0].trim();
  let speed: number | undefined;
  for (let i = 1; i < parts.length; i++) {
    const sm = parts[i].trim().match(/speed\s*=\s*([\d.]+)/);
    if (sm) speed = parseFloat(sm[1]);
  }
  lib.set(id, { id, type, raw, slots: parsePattern(raw, type), speed });
}

// ============================================================
// Chord definition
// ============================================================

function parseChordDef(
  line: string, lineNum: number,
  lib: Map<string, ChordDefinition>, warnings: BuildWarning[]
): void {
  const m = line.match(/define\s+\[([^\]]+)\]\s*:\s*\{\s*frets\s*:\s*"([^"]+)"\s*\}/);
  if (!m) { warnings.push({ message: `无法解析和弦: "${line}"`, line: lineNum }); return; }
  const name = m[1];
  const parts = m[2].trim().split(/\s+/);
  if (parts.length !== 6) {
    warnings.push({ message: `和弦 ${name} 需要 6 品位值，得到 ${parts.length}`, line: lineNum });
    return;
  }
  const frets = parts.map(s => s === 'x' || s === 'X' || s === '-1' ? -1 : parseInt(s, 10)) as GuitarFrets;
  lib.set(name, { id: name, displayName: name, frets });
}
