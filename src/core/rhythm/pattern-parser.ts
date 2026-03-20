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
  let i = 0;

  while (i < s.length) {
    const ch = s[i].toUpperCase();
    let action: StrumSlot['action'] | null = null;
    switch (ch) {
      case 'D': action = 'down'; break;
      case 'U': action = 'up'; break;
      case 'X': action = 'mute'; break;
      case '-': case '.': action = 'sustain'; break;
    }
    if (action) {
      i++;
      // 检查 fromRoot 标记 *
      if (i < s.length && s[i] === '*') {
        slots.push({ kind: 'strum', action, fromRoot: true });
        i++;
        continue;
      }
      // 检查是否有弦范围 [123]
      if (i < s.length && s[i] === '[') {
        const close = s.indexOf(']', i);
        if (close !== -1) {
          const inner = s.slice(i + 1, close);
          const strings = inner.split('').filter(c => c >= '1' && c <= '6').map(Number);
          if (strings.length > 0 && strings.length < 6) {
            slots.push({ kind: 'strum', action, strings });
          } else {
            slots.push({ kind: 'strum', action });
          }
          i = close + 1;
          continue;
        }
      }
      slots.push({ kind: 'strum', action });
    } else {
      i++;
    }
  }
  return slots;
}

// ---- 统一入口 ----

export function parsePattern(pattern: string, type: RhythmType): RhythmSlot[] {
  if (type === 'strum') return parseStrumPattern(pattern);
  return parsePluckPattern(pattern);
}
