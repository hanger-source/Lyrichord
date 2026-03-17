/**
 * Lyrichord 类型系统 v3
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  设计原则                                                │
 * │  1. 以吉他谱乐理为根基，参考 AlphaTab / MusicXML 层级    │
 * │  2. Duration 用枚举 + 附点，不用浮点拍数                  │
 * │  3. 全局信息(MasterBar) 与音轨内容(Bar) 分离              │
 * │  4. 技巧、力度、节奏型均为一等公民                        │
 * │  5. 和弦通过 chordLibrary 统一管理，Beat 只存引用         │
 * └─────────────────────────────────────────────────────────┘
 *
 * 数据流:
 *   TMD Text → scan() → Token[]
 *            → buildSong() → Song
 *            → validate() → ValidationResult
 *            → generate() → AlphaTexOutput
 *
 * 模型层级:
 *   Song
 *   ├── meta: SongMeta
 *   ├── masterBars: MasterBar[]   ← 全局小节序列
 *   ├── bars: Bar[]               ← 吉他音轨（与 masterBars 1:1）
 *   ├── rhythmLibrary             ← 节奏型模板库
 *   └── chordLibrary              ← 和弦指法库
 */

// ================================================================
//  §1  音乐基础
// ================================================================

/**
 * 音符时值
 *
 * 值 = 几分音符的分母，与 AlphaTab / powertabeditor / tuxguitar 对齐。
 * 全音符=1, 二分=2, 四分=4, 八分=8, 十六分=16, 三十二分=32, 六十四分=64
 */
export enum Duration {
  Whole        = 1,
  Half         = 2,
  Quarter      = 4,
  Eighth       = 8,
  Sixteenth    = 16,
  ThirtySecond = 32,
  SixtyFourth  = 64,
}

/**
 * 完整时值 = 基础时值 + 附点 + 可选连音
 *
 * 示例（4/4 拍，四分音符 = 1 拍）:
 *   1 拍    → { base: Quarter, dots: 0 }
 *   1.5 拍  → { base: Quarter, dots: 1 }          附点四分
 *   3 拍    → { base: Half,    dots: 1 }          附点二分
 *   2/3 拍  → { base: Quarter, dots: 0, tuplet: {enters:3, times:2} }
 */
export interface DurationValue {
  base: Duration;
  /** 0=无附点, 1=单附点, 2=双附点 */
  dots: number;
  /** 连音分割 (三连音 = DIVISION_TRIPLET, 五连音 = DIVISION_QUINTUPLET) */
  tuplet?: DivisionType;
}

/**
 * 连音分割类型 (Division Type)
 *
 * 对齐 tuxguitar 的 TGDivisionType / powertabeditor 的 IrregularGrouping:
 *   enters 个音符均分 times 个标准音符的时间
 *
 * 例: 三连音 = { enters: 3, times: 2 } — 3 个音符占 2 个标准音符的时间
 */
export interface DivisionType {
  /** 实际演奏的音符数 */
  enters: number;
  /** 等分的标准音符数 */
  times: number;
}

/** 预定义连音类型常量 */
export const DIVISION_NORMAL:      DivisionType = { enters: 1,  times: 1 };
export const DIVISION_TRIPLET:     DivisionType = { enters: 3,  times: 2 };
export const DIVISION_QUINTUPLET:  DivisionType = { enters: 5,  times: 4 };
export const DIVISION_SEXTUPLET:   DivisionType = { enters: 6,  times: 4 };
export const DIVISION_SEPTUPLET:   DivisionType = { enters: 7,  times: 4 };
export const DIVISION_NONTUPLET:   DivisionType = { enters: 9,  times: 8 };
export const DIVISION_TREDECIMOLE: DivisionType = { enters: 13, times: 8 };

/**
 * 拍号
 */
export interface TimeSignature {
  /** 分子: 每小节几拍 */
  numerator: number;
  /** 分母: 以什么音符为一拍 (4=四分, 8=八分) */
  denominator: number;
}

/**
 * 力度
 */
export enum Dynamic {
  PPP = 'ppp',
  PP  = 'pp',
  P   = 'p',
  MP  = 'mp',
  MF  = 'mf',
  F   = 'f',
  FF  = 'ff',
  FFF = 'fff',
}

// ================================================================
//  §2  吉他专属
// ================================================================

/** 6 弦品位数组 [6弦(最低)→1弦(最高)]，-1 = 不弹 */
export type GuitarFrets = [number, number, number, number, number, number];

/**
 * 吉他音符 — 弦 + 品位
 *
 * 这是吉他谱的原子单位。一个 Beat 可包含多个 Note（和弦弹奏）。
 * string 编号: 1=最细弦(高音e), 6=最粗弦(低音E)
 */
export interface Note {
  /** 弦号 1-6 */
  string: number;
  /** 品位 0-24 (0=空弦) */
  fret: number;
  /**
   * 是否连线到前一个同弦同品音符
   *
   * 对齐 alphaTab / tuxguitar 的 tie 语义:
   * tied=true 表示此音符与前面最近的同弦同品音符连线，不重新发声。
   * 比 'start'|'stop' 更简洁，也是业界标准做法。
   */
  tied?: boolean;
  /** 幽灵音 / 死音 */
  isGhost?: boolean;
  /**
   * MIDI 力度 0-127
   *
   * 对齐 MIDI velocity / tuxguitar TGVelocities:
   *   ppp=15, pp=31, p=47, mp=63, mf=79, f=95, ff=111, fff=127
   * undefined = 使用 Beat 或 MasterBar 级别的力度
   */
  velocity?: number;
  /** 音符级别技巧 */
  techniques?: NoteTechnique[];
}

/**
 * 音符级别演奏技巧
 *
 * 每种技巧附着在单个 Note 上，影响该音符的发声方式。
 * 用 tagged union 保证类型安全。
 */
export type NoteTechnique =
  | { type: 'hammer-on' }
  | { type: 'pull-off' }
  | { type: 'slide'; direction: 'up' | 'down' }
  | { type: 'bend'; semitones: number }
  | { type: 'vibrato' }
  | { type: 'harmonic'; style: 'natural' | 'artificial' | 'pinch' | 'tap' }
  | { type: 'let-ring' }
  | { type: 'palm-mute' }
  | { type: 'tap' }
  | { type: 'slap' }
  | { type: 'pop' };

/**
 * 效果互斥规则
 *
 * 对齐 powertabeditor 的效果互斥逻辑:
 * - let-ring 和 palm-mute 互斥 (物理上不可能同时)
 * - hammer-on 和 pull-off 互斥 (同一音符只能是其中一种)
 * - slap 和 pop 互斥 (贝斯技巧，同一音符只能一种)
 *
 * 返回去重后的技巧列表，后出现的同组技巧覆盖先出现的。
 */
export function validateNoteEffects(techniques: NoteTechnique[]): NoteTechnique[] {
  const exclusionGroups: string[][] = [
    ['let-ring', 'palm-mute'],
    ['hammer-on', 'pull-off'],
    ['slap', 'pop'],
  ];

  const result: NoteTechnique[] = [];
  const activeTypes = new Set<string>();

  // 后出现的覆盖先出现的 — 先反转处理，再反转回来
  for (const tech of [...techniques].reverse()) {
    if (activeTypes.has(tech.type)) continue;

    // 检查互斥组
    const group = exclusionGroups.find(g => g.includes(tech.type));
    if (group && group.some(t => activeTypes.has(t))) continue;

    activeTypes.add(tech.type);
    result.push(tech);
  }

  return result.reverse();
}

// ================================================================
//  §3  和弦
// ================================================================

/**
 * 和弦指法位置（一个变体/把位）
 *
 * 来源: @tombatossals/chords-db 或用户自定义
 */
export interface ChordPosition {
  /** 6 弦品位 [6弦→1弦]，-1=不弹 */
  frets: GuitarFrets;
  /** 手指编号 [6弦→1弦]，0=不按/空弦, 1=食指, 2=中指, 3=无名指, 4=小指 */
  fingers: GuitarFrets;
  /** 起始品位（1=开放把位） */
  baseFret: number;
  /** 横按品位列表 */
  barres: number[];
  /** 是否使用 capo 式横按 */
  capo?: boolean;
  /** 各弦 MIDI 音高（不弹的弦不包含） */
  midi: number[];
}

/**
 * 和弦指法定义
 *
 * 存储在 Song.chordLibrary 中，Beat 通过 chordId 引用。
 * 内置和弦库 + 用户自定义和弦都统一存这里。
 *
 * 支持多变体: positions 数组存所有把位/指法变体，
 * frets/fingers 是当前选中的指法（默认 positions[0]）。
 */
export interface ChordDefinition {
  /** 唯一标识 (如 "C", "Am7", "D/F#") */
  id: string;
  /** 显示名称 (可能和 id 不同，如别名 "D/#F" → 显示 "D/F#") */
  displayName: string;
  /** 当前选中的 6 弦指法（= positions[selectedPosition].frets） */
  frets: GuitarFrets;
  /** 当前选中的手指编号 */
  fingers?: GuitarFrets;
  /** 起始品位 — 高把位和弦图显示用 */
  firstFret?: number;
  /** 横按信息 */
  barre?: BarreInfo;
  /** 根音弦号 (1-6) */
  rootString?: number;
  /** 是否为 Slash Chord */
  isSlash?: boolean;
  /** Slash Chord 的 bass 音名 */
  bassNote?: string;
  /** 所有指法变体 */
  positions?: ChordPosition[];
  /** 当前选中的 position 索引（默认 0） */
  selectedPosition?: number;
  /** 各弦 MIDI 音高 */
  midi?: number[];
  /** 和弦根音 (key)，如 "C", "A" */
  key?: string;
  /** 和弦类型后缀，如 "major", "minor", "7" */
  suffix?: string;
}

/** 横按 */
export interface BarreInfo {
  fret: number;
  fromString: number;
  toString: number;
}

// ================================================================
//  §4  节奏型
// ================================================================

/** 节奏型大类 */
export type RhythmType = 'pluck' | 'strum';

/**
 * 节奏型模板
 *
 * TMD 的核心特色：用户定义几种节奏型，段落中引用，
 * 系统自动将和弦 + 节奏型展开为具体音符序列。
 */
export interface RhythmPattern {
  /** 唯一标识 (如 "R1", "R2A") */
  id: string;
  /** 类型 */
  type: RhythmType;
  /** 原始 pattern 字符串 (调试/显示用) */
  raw: string;
  /** 解析后的动作序列 — 等分小节时间 */
  slots: RhythmSlot[];
  /** 速度缩放 (默认 1.0) */
  speed?: number;
}

/**
 * 节奏型时间槽 — 一个最小时间单位内的动作
 */
export type RhythmSlot = PluckSlot | StrumSlot;

/** 拨弦动作 */
export type PluckSlot =
  | { kind: 'pluck'; target: 'root' }
  | { kind: 'pluck'; target: 'strings'; strings: number[] };

/** 扫弦动作 */
export type StrumSlot =
  | { kind: 'strum'; action: 'down' }
  | { kind: 'strum'; action: 'up' }
  | { kind: 'strum'; action: 'mute' }     // 闷音/切音 (X)
  | { kind: 'strum'; action: 'sustain' };  // 延音 (-)

// ================================================================
//  §5  Beat — 拍 (核心音乐事件)
// ================================================================

/**
 * Beat — 一拍
 *
 * 对齐 AlphaTab 的 Beat 概念:
 * - 有明确时值 (DurationValue)
 * - 包含 0~N 个 Note
 * - 可以是休止、延续、或实际发声
 * - 携带演奏指令
 */
export interface Beat {
  /** 时值 */
  duration: DurationValue;
  /** 音符列表 (空 + isRest=true → 休止) */
  notes: Note[];
  /** 是否休止 */
  isRest: boolean;
  /**
   * 精确时间位置 (tick)，相对于小节起始
   *
   * 对齐 alphaTab Beat.playbackStart / tuxguitar TGBeat.start:
   * 用于精确定位 beat 在小节内的时间偏移。
   * 单位: 以四分音符 = 960 ticks (MIDI 标准 PPQ)
   * undefined = 由播放引擎按顺序计算
   */
  tick?: number;
  /**
   * 和弦引用 (chordLibrary 的 key)
   *
   * 有 chordId → notes 由节奏型展开器根据指法自动填充
   * 无 chordId → 延续上一个和弦
   */
  chordId?: string;
  /**
   * 和弦级别节奏型引用
   *
   * 来自 TMD 小节行的 C@R1 格式。
   * 有 rhythmId → 该和弦区间用节奏型展开
   * 无 rhythmId → 用 tex 行精确 beat 或 fallback
   */
  rhythmId?: string;
  /** 歌词片段 */
  lyrics?: string;
  /** 演奏控制 */
  playback?: BeatPlayback;
}

/** Beat 级别的演奏控制 */
export interface BeatPlayback {
  /** 扫弦方向 */
  brush?: BrushType;
  /** 力度覆盖 */
  dynamic?: Dynamic;
  /** 渐强/渐弱 */
  crescendo?: 'crescendo' | 'decrescendo';
  /** 延音 */
  letRing?: boolean;
  /** 闷音 */
  palmMute?: boolean;
  /** 死音拍 (扫弦 X) */
  isDeadSlap?: boolean;
  /** 连音线 — 与下一拍连接 */
  tieToNext?: boolean;
}

/** 扫弦方向 */
export enum BrushType {
  None = 'none',
  Down = 'down',
  Up   = 'up',
}

// ================================================================
//  §6  Bar / MasterBar — 小节
// ================================================================

/**
 * MasterBar — 全局小节信息
 *
 * 参考 AlphaTab 的 MasterBar:
 * 全局属性 (拍号、反复、段落、速度) 与音轨内容分离。
 * 未来多音轨时全局信息只存一份。
 */
export interface MasterBar {
  /** 小节索引 (0-based) */
  index: number;

  // ---- 拍号 / 速度 ----
  /** 拍号变化 (undefined=沿用上一小节) */
  timeSignature?: TimeSignature;
  /** 速度变化 BPM (undefined=沿用) */
  tempo?: number;

  // ---- 段落 ----
  /** 段落标记 */
  section?: SectionMarker;

  // ---- 反复 ----
  /** 反复开始 */
  isRepeatStart?: boolean;
  /** 反复结束 (值=反复次数) */
  repeatCount?: number;
  /** Volta 括号 (位掩码: bit0=第1次, bit1=第2次...) */
  alternateEndings?: number;

  // ---- 其他 ----
  /** 弱起小节 (anacrusis / pickup bar) */
  isAnacrusis?: boolean;
  /** 力度标记 (影响后续直到下一个力度标记) */
  dynamic?: Dynamic;
  /** 节奏型引用 (影响后续直到下一个引用) */
  rhythmId?: string;
}

/** 段落标记 */
export interface SectionMarker {
  name: string;
  text?: string;
}

/**
 * Bar — 吉他音轨的小节内容
 *
 * 一个 Bar 对应一个 MasterBar，包含该小节内所有 Beat。
 */
export interface Bar {
  /** 对应的 MasterBar 索引 */
  masterBarIndex: number;
  /** 拍序列 (默认 voice 0) */
  beats: Beat[];
  /**
   * 多声部预留
   *
   * 对齐 alphaTab Voice[] / tuxguitar TGVoice[]:
   * voices[0] = 主声部 (等同于 beats)
   * voices[1] = 第二声部 (如有)
   * undefined = 单声部，使用 beats
   */
  voices?: Beat[][];
}

// ================================================================
//  §7  Song — 顶层模型
// ================================================================

/** 曲目元数据 */
export interface SongMeta {
  title?: string;
  artist?: string;
  album?: string;
  /** 初始速度 BPM */
  tempo: number;
  /** 初始拍号 */
  timeSignature: TimeSignature;
  /** 变调夹品位 (0=无) */
  capo: number;
  /** 吉他调弦 MIDI 音高 (默认标准 EADGBE = [40,45,50,55,59,64]) */
  tuning?: number[];
}

/**
 * Song — 完整曲目模型
 *
 * 这是整个系统的核心数据结构。
 * TMD 解析器产出 Song，AlphaTex 生成器消费 Song。
 */
export interface Song {
  meta: SongMeta;
  /** 全局小节序列 */
  masterBars: MasterBar[];
  /** 吉他音轨小节 (与 masterBars 一一对应) */
  bars: Bar[];
  /** 节奏型模板库 */
  rhythmLibrary: Map<string, RhythmPattern>;
  /** 和弦指法库 (内置 + 用户自定义) */
  chordLibrary: Map<string, ChordDefinition>;
}

// ================================================================
//  §8  Token (词法分析输出)
// ================================================================

export type TokenType =
  | 'META_KEY'     | 'META_VALUE'
  | 'RHYTHM_DEF'   | 'CHORD_DEF'
  | 'SECTION'      | 'CHORD'       | 'CHORD_BEATS'
  | 'LYRICS'       | 'REST'        | 'BAR_LINE'
  | 'RHYTHM_REF'   | 'NEWLINE'
  | 'HEADER_START' | 'HEADER_END'  | 'COMMENT'
  | 'NOTE_EVENT'   // v4: "." = hold beat (延续拍), 或 tex 行的 AlphaTex beat
  | 'CHORD_MARK'   // [C] 和弦位置标记 (歌词行/tex行)
  | 'CHORD_BEAT'   // v4: 小节行里的和弦名，占1拍
  | 'TEX_START'    // tex: 行开始标记
  | 'W2_START'     // w2: 行开始标记
  | 'SEGMENT_REF'; // @segment(Name) — 引用 TAB 段落，pipeline 展开时替换为实际 TMD body

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ================================================================
//  §9  Generator 输出
// ================================================================

/** 生成器产出的一个小节 */
export interface GeneratedMeasure {
  /** AlphaTex 音符序列 */
  notes: string;
  /** 歌词 */
  lyrics?: string;
  /** 力度 */
  dynamic?: Dynamic;
}

/** 完整 AlphaTex 生成结果 */
export interface AlphaTexOutput {
  /** 完整 AlphaTex 字符串 */
  tex: string;
  /** 按小节拆分 (歌词同步用) */
  measures: GeneratedMeasure[];
}

// ================================================================
//  §10  工具类型
// ================================================================

/**
 * 浮点拍数 → DurationValue 转换表
 *
 * 供 ast-builder 等模块使用。
 * 在 4/4 拍中 (四分音符 = 1 拍):
 *   4    → Whole
 *   3    → Half dotted
 *   2    → Half
 *   1.5  → Quarter dotted
 *   1    → Quarter
 *   0.75 → Eighth dotted
 *   0.5  → Eighth
 *   0.25 → Sixteenth
 */
export function beatsToDuration(beats: number): DurationValue {
  const table: Array<[number, Duration, number]> = [
    [4,     Duration.Whole,        0],
    [3,     Duration.Half,         1],
    [2,     Duration.Half,         0],
    [1.5,   Duration.Quarter,      1],
    [1,     Duration.Quarter,      0],
    [0.75,  Duration.Eighth,       1],
    [0.5,   Duration.Eighth,       0],
    [0.375, Duration.Sixteenth,    1],
    [0.25,  Duration.Sixteenth,    0],
    [0.125, Duration.ThirtySecond, 0],
  ];
  for (const [b, base, dots] of table) {
    if (Math.abs(beats - b) < 0.01) return { base, dots };
  }
  // fallback: 最接近的较小标准时值
  if (beats > 3)   return { base: Duration.Half,         dots: 1 };
  if (beats > 2)   return { base: Duration.Half,         dots: 0 };
  if (beats > 1.5) return { base: Duration.Quarter,      dots: 1 };
  if (beats > 1)   return { base: Duration.Quarter,      dots: 0 };
  if (beats > 0.5) return { base: Duration.Eighth,       dots: 0 };
  if (beats > 0.25) return { base: Duration.Sixteenth,   dots: 0 };
  return { base: Duration.ThirtySecond, dots: 0 };
}

/**
 * DurationValue → 浮点拍数
 *
 * 在 4/4 拍中 Quarter=1 拍。
 * 公式: (4 / base) * dotMultiplier * tupletRatio
 */
export function durationToBeats(dv: DurationValue): number {
  let beats = 4 / dv.base;
  // 附点: 每个点加上前一个值的一半
  let dotValue = beats / 2;
  for (let i = 0; i < dv.dots; i++) {
    beats += dotValue;
    dotValue /= 2;
  }
  // 连音
  if (dv.tuplet) {
    beats = beats * (dv.tuplet.times / dv.tuplet.enters);
  }
  return beats;
}

/**
 * DurationValue → AlphaTex 时值字符串
 *
 * 例: { base: Quarter, dots: 1 } → "4{d}"
 *     { base: Half, dots: 0 }    → "2"
 */
export function durationToAlphaTex(dv: DurationValue): string {
  let s = String(dv.base);
  if (dv.dots === 1) s += '{d}';
  if (dv.dots === 2) s += '{dd}';
  return s;
}
