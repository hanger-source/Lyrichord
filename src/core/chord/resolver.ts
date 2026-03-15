/**
 * 和弦解析器
 *
 * 职责:
 * 1. 标准化和弦名称 (别名处理)
 * 2. 从数据库查找指法
 * 3. 构建 ChordDefinition
 * 4. 管理用户自定义和弦
 */
import type { ChordDefinition, GuitarFrets } from '../types';
import { CHORD_DATABASE, CHORD_ALIASES } from './database';

/** 用户自定义和弦 */
let customChords = new Map<string, GuitarFrets>();

export function clearCustomChords(): void {
  customChords = new Map();
}

export function setCustomChords(chords: Map<string, ChordDefinition>): void {
  customChords = new Map();
  for (const [k, v] of chords) {
    customChords.set(k, v.frets);
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

/** 查找指法 */
export function findFrets(name: string): GuitarFrets | null {
  const custom = customChords.get(name);
  if (custom) return custom;
  const exact = CHORD_DATABASE[name];
  if (exact) return exact;
  const norm = normalizeChordName(name);
  return customChords.get(norm) ?? CHORD_DATABASE[norm] ?? null;
}

/** 解析和弦 → ChordDefinition */
export function resolveChord(raw: string): ChordDefinition | null {
  const name = normalizeChordName(raw);
  const frets = findFrets(name);
  if (!frets) return null;

  const isSlash = name.includes('/');
  const parts = isSlash ? name.split('/') : null;

  return {
    id: name,
    displayName: name,
    frets,
    isSlash,
    bassNote: parts?.[1],
    rootString: findRootString(frets),
  };
}

/** 找根音弦号 (最低有效弦) */
function findRootString(frets: GuitarFrets): number {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return 6 - i;
  }
  return 6;
}
