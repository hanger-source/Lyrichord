/**
 * 节奏型展开器
 *
 * Slot(抽象动作) + ChordFrets(具体指法) → NoteEvent[](物理坐标)
 */
import type { RhythmSlot, RhythmType, Note, GuitarFrets } from '../types';

/** 展开后的单个音符事件 */
export interface NoteEvent {
  notes: Note[];
  isRest: boolean;
  isSustain: boolean;
  brushDirection?: 'down' | 'up';
  isDeadNote?: boolean;
}

/** 找根音 (最低有效弦) */
function findRoot(frets: GuitarFrets): Note {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return { string: 6 - i, fret: frets[i] };
  }
  return { string: 6, fret: 0 };
}

/** 获取指定弦品位 */
function getFret(frets: GuitarFrets, str: number): number {
  return frets[6 - str] ?? -1;
}

/** 获取所有有效弦 */
function allPlayable(frets: GuitarFrets): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) notes.push({ string: 6 - i, fret: frets[i] });
  }
  return notes;
}

/** 展开拨弦 */
function expandPluck(slots: RhythmSlot[], frets: GuitarFrets): NoteEvent[] {
  const root = findRoot(frets);
  return slots.map((slot): NoteEvent => {
    if (slot.kind !== 'pluck') return { notes: [], isRest: true, isSustain: false };
    if (slot.target === 'root') {
      return { notes: [root], isRest: false, isSustain: false };
    }
    const notes: Note[] = [];
    for (const s of slot.strings) {
      const f = getFret(frets, s);
      if (f >= 0) notes.push({ string: s, fret: f });
    }
    return notes.length > 0
      ? { notes, isRest: false, isSustain: false }
      : { notes: [], isRest: true, isSustain: false };
  });
}

/** 展开扫弦 */
function expandStrum(slots: RhythmSlot[], frets: GuitarFrets): NoteEvent[] {
  const all = allPlayable(frets);
  return slots.map((slot): NoteEvent => {
    if (slot.kind !== 'strum') return { notes: [], isRest: true, isSustain: false };
    switch (slot.action) {
      case 'down':
        return { notes: [...all], isRest: false, isSustain: false, brushDirection: 'down' };
      case 'up':
        return { notes: [...all], isRest: false, isSustain: false, brushDirection: 'up' };
      case 'mute':
        return { notes: [...all], isRest: false, isSustain: false, isDeadNote: true, brushDirection: 'down' };
      case 'sustain':
        return { notes: [], isRest: false, isSustain: true };
      default:
        return { notes: [], isRest: true, isSustain: false };
    }
  });
}

/** 统一入口 */
export function expandRhythm(
  type: RhythmType,
  slots: RhythmSlot[],
  frets: GuitarFrets
): NoteEvent[] {
  return type === 'strum' ? expandStrum(slots, frets) : expandPluck(slots, frets);
}
