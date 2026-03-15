/**
 * 指法坐标计算
 *
 * 从 GuitarFrets 数组提取物理坐标，为 AlphaTex 生成提供数据。
 */
import type { Note, GuitarFrets } from '../types';

/** 找根音 (最低有效弦) */
export function findRoot(frets: GuitarFrets): Note {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return { string: 6 - i, fret: frets[i] };
  }
  return { string: 6, fret: 0 };
}

/** 获取指定弦品位，-1=不弹 */
export function getFretOnString(frets: GuitarFrets, str: number): number {
  const idx = 6 - str;
  if (idx < 0 || idx >= frets.length) return -1;
  return frets[idx];
}

/** 获取所有有效弦音符 (6→1 顺序) */
export function getPlayableNotes(frets: GuitarFrets): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) notes.push({ string: 6 - i, fret: frets[i] });
  }
  return notes;
}

/** 单音 → AlphaTex: "fret.string" */
export function noteToAlphaTex(note: Note): string {
  return `${note.fret}.${note.string}`;
}

/** 多音 → AlphaTex: 单音 "3.6"，多音 "(3.6 2.5 0.4)" */
export function notesToAlphaTex(notes: Note[]): string {
  if (notes.length === 0) return 'r';
  if (notes.length === 1) return noteToAlphaTex(notes[0]);
  return `(${notes.map(noteToAlphaTex).join(' ')})`;
}
