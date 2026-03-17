/**
 * Song 语义校验器
 */
import type { Song } from '../types';
import { durationToBeats } from '../types';
import { findFrets } from '../chord/resolver';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: string;
  message: string;
  target: string;
}

export interface ValidationWarning {
  type: string;
  message: string;
  target: string;
}

export function validate(song: Song): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const usedChords = new Set<string>();
  const usedRhythms = new Set<string>();

  // 收集引用
  for (const mb of song.masterBars) {
    if (mb.rhythmId) usedRhythms.add(mb.rhythmId);
  }

  for (let i = 0; i < song.bars.length; i++) {
    const bar = song.bars[i];
    const mb = song.masterBars[bar.masterBarIndex];
    const ts = mb?.timeSignature ?? song.meta.timeSignature;

    for (const beat of bar.beats) {
      if (beat.chordId) usedChords.add(beat.chordId);
    }

    // 校验小节拍数（token 数量应等于拍号拍数）
    const actual = bar.beats.reduce((s, b) => s + durationToBeats(b.duration), 0);
    const expectedBeats = ts.numerator * (4 / ts.denominator);
    if (Math.abs(actual - expectedBeats) > 0.01) {
      warnings.push({
        type: 'beat-count-mismatch',
        message: `小节 ${i + 1}: 实际 ${actual} 拍，期望 ${expectedBeats} 拍（${ts.numerator}/${ts.denominator} 拍号要求小节行有 ${ts.numerator} 个 token）`,
        target: String(i),
      });
    }
  }

  // 检查和弦
  usedChords.forEach(chord => {
    // 先查 chordLibrary (用户自定义)，再查内置库
    if (!song.chordLibrary.has(chord) && !findFrets(chord)) {
      errors.push({
        type: 'unknown-chord',
        message: `未知和弦: ${chord}`,
        target: chord,
      });
    }
  });

  // 检查节奏型
  usedRhythms.forEach(rid => {
    if (!song.rhythmLibrary.has(rid)) {
      errors.push({
        type: 'unknown-rhythm',
        message: `未定义节奏型: @${rid}`,
        target: rid,
      });
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}
