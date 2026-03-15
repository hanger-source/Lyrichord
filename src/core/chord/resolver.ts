/**
 * 和弦解析器
 *
 * 职责:
 * 1. 标准化和弦名称 (别名处理)
 * 2. 从 chords-db 查找完整指法（含多变体、手指、MIDI）
 * 3. 构建 ChordDefinition
 * 4. 管理用户自定义和弦
 */
import type { ChordDefinition, GuitarFrets } from '../types';
import { getChordFromDB, CHORD_ALIASES } from './database';

/** 用户自定义和弦（TMD define 语法） */
let customChords = new Map<string, ChordDefinition>();

export function clearCustomChords(): void {
  customChords = new Map();
}

export function setCustomChords(chords: Map<string, ChordDefinition>): void {
  customChords = new Map();
  for (const [k, v] of chords) {
    customChords.set(k, v);
  }
}

/** 标准化和弦名 */
export function normalizeChordName(raw: string): string {
  if (CHORD_ALIASES[raw]) return CHORD_ALIASES[raw];
  const m = raw.match(/^#([A-G])(.*)/);
  if (m) {
    const n = `${m[1]}#${m[2]}`;
    return CHORD_ALIASES[n] ?? n;
  }
  return raw;
}

/** 查找指法（仅 frets，兼容旧调用） */
export function findFrets(name: string): GuitarFrets | null {
  const def = resolveChord(name);
  return def?.frets ?? null;
}

/** 解析和弦 → 完整 ChordDefinition（含 positions、fingers、midi） */
export function resolveChord(raw: string): ChordDefinition | null {
  const name = normalizeChordName(raw);

  // 1. 先查用户自定义
  const custom = customChords.get(name) ?? customChords.get(raw);
  if (custom) return custom;

  // 2. 查 chords-db
  const fromDB = getChordFromDB(name);
  if (fromDB) return fromDB;

  // 3. 尝试原始名
  if (name !== raw) {
    const fromDBRaw = getChordFromDB(raw);
    if (fromDBRaw) return fromDBRaw;
  }

  return null;
}
