/**
 * TAB 编辑器数据模型、常量、基础工具函数
 */

// ---- 数据模型 ----

export type StringMark =
  | { type: 'none' }
  | { type: 'chord' }
  | { type: 'custom'; fret: number };

export type Strings6 = [StringMark, StringMark, StringMark, StringMark, StringMark, StringMark];

export interface ChordRegion {
  fromBeat: number;
  toBeat: number;
  name: string;
  /** 指法变体索引（对应 ChordDefinition.positions[idx]） */
  positionIndex?: number;
}

export interface TabBeat {
  strings: Strings6;
  weight: number;
  group: number;
  rest?: boolean;
  /** 扫弦方向: 'ad'=arpeggio down, 'au'=arpeggio up, 'ds'=dead slap */
  brush?: 'ad' | 'au' | 'ds';
}

export interface TabMeasure {
  beats: TabBeat[];
  chords: ChordRegion[];
}

export interface ChordSelectionPending {
  measureIdx: number;
  fromBeat: number;
  toBeat: number;
}

// ---- 常量 ----
export const STRING_COUNT = 6;
export const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
export const LABEL_W = 28;
export const TIME_SIGS: [string, number][] = [['3/4', 6], ['4/4', 8], ['6/8', 6]];

// ---- 基础工具函数 ----

export function emptyStrings(): Strings6 {
  return [
    { type: 'none' }, { type: 'none' }, { type: 'none' },
    { type: 'none' }, { type: 'none' }, { type: 'none' },
  ];
}

export function mkBeat(weight: number, group: number): TabBeat {
  return { strings: emptyStrings(), weight, group };
}

export function mkMeasure(bpm: number): TabMeasure {
  const beats: TabBeat[] = [];
  for (let i = 0; i < bpm; i++) beats.push(mkBeat(1, Math.floor(i / 2)));
  return { beats, chords: [] };
}
