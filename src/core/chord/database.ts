/**
 * 和弦指法数据库
 *
 * 数据源: @tombatossals/chords-db（开源吉他和弦库）
 * 每个和弦包含多个 positions（变体/把位），带手指编号、横按、MIDI 音高。
 *
 * 适配层: 将 chords-db 的数据格式转换为 Lyrichord 的 ChordDefinition。
 */
import type { ChordDefinition, ChordPosition, GuitarFrets, BarreInfo } from '../types';
import guitarData from '@tombatossals/chords-db/lib/guitar.json';

// ---- chords-db 原始类型 ----
interface RawPosition {
  frets: number[];
  fingers: number[];
  baseFret: number;
  barres: number[];
  capo?: boolean;
  midi: number[];
}

interface RawChord {
  key: string;
  suffix: string;
  positions: RawPosition[];
}

// ---- suffix → 显示名映射 ----
const SUFFIX_DISPLAY: Record<string, string> = {
  'major': '', 'minor': 'm', 'dim': 'dim', 'dim7': 'dim7',
  'sus2': 'sus2', 'sus4': 'sus4', '7sus4': '7sus4',
  'aug': 'aug', '6': '6', '69': '69',
  '7': '7', '7b5': '7b5', 'aug7': 'aug7',
  '9': '9', '9b5': '9b5', 'aug9': 'aug9',
  '7b9': '7b9', '7#9': '7#9', 'b13b9': 'b13b9',
  'maj7': 'maj7', 'maj7b5': 'maj7b5', 'maj7#5': 'maj7#5',
  'maj9': 'maj9', 'maj11': 'maj11', 'maj13': 'maj13',
  'm6': 'm6', 'm69': 'm69', 'm7': 'm7', 'm7b5': 'm7b5',
  'm9': 'm9', 'm11': 'm11', 'mmaj7': 'mmaj7', 'mmaj7b5': 'mmaj7b5',
  'mmaj9': 'mmaj9', 'mmaj11': 'mmaj11',
  'add9': 'add9', 'madd9': 'madd9',
  '11': '11', '13': '13',
  '/E': '/E', '/F': '/F', '/F#': '/F#', '/G': '/G',
  '/G#': '/G#', '/A': '/A', '/Bb': '/Bb', '/B': '/B',
  '/C': '/C', '/C#': '/C#', '/D': '/D', '/D#': '/D#',
  '7sg': '7', 'alt': 'alt',
};

// ---- key 名映射 (chords-db 用 "Csharp"/"Fsharp" 而非 "C#"/"F#") ----
const KEY_MAP: Record<string, string> = {
  'C': 'C', 'Csharp': 'C#', 'D': 'D', 'Eb': 'Eb',
  'E': 'E', 'F': 'F', 'Fsharp': 'F#', 'G': 'G',
  'Ab': 'Ab', 'A': 'A', 'Bb': 'Bb', 'B': 'B',
};


/**
 * 将 chords-db 的 RawPosition 转换为 ChordPosition
 */
function convertPosition(raw: RawPosition): ChordPosition {
  return {
    frets: raw.frets.slice(0, 6) as unknown as GuitarFrets,
    fingers: raw.fingers.slice(0, 6) as unknown as GuitarFrets,
    baseFret: raw.baseFret,
    barres: raw.barres ?? [],
    capo: raw.capo,
    midi: raw.midi ?? [],
  };
}

/**
 * 构建和弦 ID（显示名称）
 * 如 key="C", suffix="major" → "C"
 *    key="A", suffix="minor" → "Am"
 *    key="D", suffix="7" → "D7"
 */
function buildChordId(key: string, suffix: string): string {
  const displaySuffix = SUFFIX_DISPLAY[suffix] ?? suffix;
  return `${key}${displaySuffix}`;
}

/**
 * 从 position 推断横按信息
 */
function inferBarre(pos: ChordPosition): BarreInfo | undefined {
  if (pos.barres.length === 0) return undefined;
  const barreFret = pos.barres[0];
  // 找横按覆盖的弦范围
  let fromString = 6;
  let toString = 1;
  for (let i = 0; i < 6; i++) {
    const stringNum = 6 - i;
    if (pos.frets[i] === barreFret || (pos.frets[i] >= 0 && pos.fingers[i] === pos.fingers[pos.frets.indexOf(barreFret)])) {
      fromString = Math.min(fromString, stringNum);
      toString = Math.max(toString, stringNum);
    }
  }
  return { fret: barreFret + pos.baseFret - 1, fromString: toString, toString: fromString };
}

/**
 * 找根音弦号
 */
function findRootString(frets: GuitarFrets): number {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return 6 - i;
  }
  return 6;
}

/**
 * 从 chords-db 构建完整的 ChordDefinition
 */
/**
 * 将相对品位转为绝对品位
 * chords-db: frets 是 1-based relative to baseFret
 * 绝对品位 = relativeFret + baseFret - 1 (0 和 -1 保持不变)
 */
function toAbsoluteFrets(relativeFrets: GuitarFrets, baseFret: number): GuitarFrets {
  return relativeFrets.map(f => {
    if (f <= 0) return f; // 0=空弦, -1=不弹
    return f + baseFret - 1;
  }) as unknown as GuitarFrets;
}

function rawToChordDef(raw: RawChord, key: string): ChordDefinition {
  const id = buildChordId(key, raw.suffix);
  const positions = raw.positions.map(convertPosition);
  const first = positions[0];
  const isSlash = raw.suffix.startsWith('/');

  // frets/fingers 存绝对品位，供 voicing/AlphaTex 生成使用
  // positions 保留原始相对品位，供 chord-diagram 渲染使用
  const absoluteFrets = toAbsoluteFrets(first.frets, first.baseFret);

  return {
    id,
    displayName: id,
    frets: absoluteFrets,
    fingers: first.fingers,
    firstFret: first.baseFret,
    barre: inferBarre(first),
    rootString: findRootString(absoluteFrets),
    isSlash,
    bassNote: isSlash ? raw.suffix.slice(1) : undefined,
    positions,
    selectedPosition: 0,
    midi: first.midi,
    key,
    suffix: raw.suffix,
  };
}


// ---- 构建完整和弦库 ----

/** 按 ID 索引的和弦库（所有变体） */
const CHORD_MAP = new Map<string, ChordDefinition>();

/** 按 key+suffix 索引 */
const CHORD_BY_KEY_SUFFIX = new Map<string, ChordDefinition>();

// 初始化
const chords = (guitarData as any).chords as Record<string, RawChord[]>;
for (const [rawKey, chordList] of Object.entries(chords)) {
  const key = KEY_MAP[rawKey] ?? rawKey;
  for (const raw of chordList) {
    const def = rawToChordDef(raw, key);
    CHORD_MAP.set(def.id, def);
    CHORD_BY_KEY_SUFFIX.set(`${key}:${raw.suffix}`, def);
  }
}

// ---- 公开 API ----

/**
 * 按 ID 查找和弦（如 "C", "Am7", "D7"）
 */
export function getChordFromDB(id: string): ChordDefinition | undefined {
  return CHORD_MAP.get(id);
}

/**
 * 按 key + suffix 查找（如 key="C", suffix="major"）
 */
export function getChordByKeySuffix(key: string, suffix: string): ChordDefinition | undefined {
  return CHORD_BY_KEY_SUFFIX.get(`${key}:${suffix}`);
}

/**
 * 获取所有和弦 ID
 */
export function getAllChordIds(): string[] {
  return Array.from(CHORD_MAP.keys());
}

/**
 * 获取所有和弦定义
 */
export function getAllChordDefs(): ChordDefinition[] {
  return Array.from(CHORD_MAP.values());
}

/**
 * 获取某个根音下的所有和弦
 */
export function getChordsByKey(key: string): ChordDefinition[] {
  const result: ChordDefinition[] = [];
  for (const [k, v] of CHORD_BY_KEY_SUFFIX) {
    if (k.startsWith(`${key}:`)) result.push(v);
  }
  return result;
}

/**
 * 搜索和弦（模糊匹配 ID）
 */
export function searchChordsInDB(query: string): ChordDefinition[] {
  const q = query.toLowerCase();
  const result: ChordDefinition[] = [];
  for (const [id, def] of CHORD_MAP) {
    if (id.toLowerCase().includes(q)) result.push(def);
  }
  return result;
}

// ---- 兼容旧接口 ----

/**
 * 旧版 CHORD_DATABASE 兼容（只返回默认指法）
 * @deprecated 使用 getChordFromDB 代替
 */
export const CHORD_DATABASE: Record<string, GuitarFrets> = {};
for (const [id, def] of CHORD_MAP) {
  CHORD_DATABASE[id] = def.frets;
}

/** 别名映射 */
export const CHORD_ALIASES: Record<string, string> = {
  '#D': 'Eb', 'D#': 'Eb', 'D/#F': 'D/F#',
  'A#': 'Bb', 'G#': 'Ab', 'D#m': 'Ebm', 'A#m': 'Bbm',
  'Bo': 'Bdim',
  'C+': 'Caug', 'D+': 'Daug', 'E+': 'Eaug',
  'F+': 'Faug', 'G+': 'Gaug', 'A+': 'Aaug',
};
