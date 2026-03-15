/**
 * 小节布局工具 v2
 * 
 * v2 中小节分配已移至 AST Builder（由 BAR_LINE token 驱动）。
 * 此模块保留为辅助工具，提供小节相关的计算函数。
 */
import type { TimeSignature } from '../types';

/**
 * 计算一个小节的总拍数
 */
export function beatsPerMeasure(ts: TimeSignature): number {
  return ts.numerator;
}

/**
 * 检查拍数是否合法（能被标准时值表示）
 */
export function isValidBeatDuration(beats: number): boolean {
  // 合法的拍数：4, 3, 2, 1.5, 1, 0.5, 0.25
  const valid = [4, 3, 2, 1.5, 1, 0.5, 0.25];
  return valid.includes(beats);
}
