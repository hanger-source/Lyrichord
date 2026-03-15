/**
 * 节奏型模板语法解析
 *
 * 拨弦语法 (pluck):
 *   p         根音
 *   1-6       指定弦号
 *   (12)      同时弹 1弦和2弦
 *   -         分隔符
 *
 * 扫弦语法 (strum):
 *   D         下扫
 *   U         上扫
 *   X         闷音/切音
 *   ./-       延音
 *   |         拍组分隔（视觉辅助，忽略）
 */
import type { RhythmSlot, RhythmType, PluckSlot, StrumSlot } from '../types';

// ---- 拨弦 ----

export function parsePluckPattern(pattern: string): PluckSlot[] {
  const slots: PluckSlot[] = [];
  const s = pattern.replace(/\s+/g, '');
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '-' || ch === ' ') { i++; continue; }

    if (ch === 'p' || ch === 'P') {
      slots.push({ kind: 'pluck', target: 'root' });
      i++; continue;
    }

    if (ch === '(') {
      const close = s.indexOf(')', i);
      if (close === -1) { i++; continue; }
      const inner = s.slice(i + 1, close);
      const strings = inner.split('').filter(c => c >= '1' && c <= '6').map(Number);
      if (strings.length > 0) {
        slots.push({ kind: 'pluck', target: 'strings', strings });
      }
      i = close + 1; continue;
    }

    if (ch >= '1' && ch <= '6') {
      slots.push({ kind: 'pluck', target: 'strings', strings: [parseInt(ch)] });
      i++; continue;
    }

    i++;
  }
  return slots;
}

// ---- 扫弦 ----

export function parseStrumPattern(pattern: string): StrumSlot[] {
  const slots: StrumSlot[] = [];
  const s = pattern.replace(/[|\s]/g, '');

  for (const ch of s) {
    switch (ch.toUpperCase()) {
      case 'D': slots.push({ kind: 'strum', action: 'down' }); break;
      case 'U': slots.push({ kind: 'strum', action: 'up' }); break;
      case 'X': slots.push({ kind: 'strum', action: 'mute' }); break;
      case '-': case '.': slots.push({ kind: 'strum', action: 'sustain' }); break;
    }
  }
  return slots;
}

// ---- 统一入口 ----

export function parsePattern(pattern: string, type: RhythmType): RhythmSlot[] {
  if (type === 'strum') return parseStrumPattern(pattern);
  return parsePluckPattern(pattern);
}
