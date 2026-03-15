/**
 * 时值计算引擎
 * 
 * 基于 MIDI 标准的 Tick 系统，将拍号和节奏型 slot 数量
 * 转换为每个 slot 的精确时值。
 * 
 * MIDI 标准: 四分音符 = 480 Ticks
 * 
 * 计算公式:
 *   一小节总 Ticks = (480 × 4 × 分子) / 分母
 *   每 Slot Ticks = 一小节总 Ticks / Slot 数量
 * 
 * 示例 (4/4 拍):
 *   总 Ticks = (480 × 4 × 4) / 4 = 1920
 *   @R1 有 4 个 slot → 每 slot 480 Ticks（四分音符）
 *   @R1+ 有 8 个 slot → 每 slot 240 Ticks（八分音符）
 */
import type { TimeSignature } from '../types';

/** 标准 MIDI 四分音符 Tick 数 */
export const TICKS_PER_QUARTER = 480;

/**
 * 计算一小节的总 Tick 数
 */
export function ticksPerMeasure(ts: TimeSignature): number {
  return (TICKS_PER_QUARTER * 4 * ts.numerator) / ts.denominator;
}

/**
 * 计算每个 Slot 的 Tick 数
 * 
 * @param ts - 拍号
 * @param slotCount - 一小节内的 slot 数量
 * @returns 每个 slot 的 Tick 数
 */
export function ticksPerSlot(ts: TimeSignature, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return ticksPerMeasure(ts) / slotCount;
}

/**
 * 将 Tick 数转换为 AlphaTex 时值标记
 * 
 * AlphaTex 时值:
 *   1  = 全音符 (1920 ticks in 4/4)
 *   2  = 二分音符 (960)
 *   4  = 四分音符 (480)
 *   8  = 八分音符 (240)
 *   16 = 十六分音符 (120)
 *   32 = 三十二分音符 (60)
 * 
 * @returns AlphaTex 时值数字，如 4, 8, 16
 */
export function ticksToDuration(ticks: number): number {
  // 标准映射
  const map: [number, number][] = [
    [1920, 1],
    [960, 2],
    [480, 4],
    [240, 8],
    [120, 16],
    [60, 32],
  ];

  // 找最接近的标准时值
  let closest = 4; // 默认四分音符
  let minDiff = Infinity;

  for (const [tickVal, duration] of map) {
    const diff = Math.abs(ticks - tickVal);
    if (diff < minDiff) {
      minDiff = diff;
      closest = duration;
    }
  }

  return closest;
}

/**
 * 根据 slot 数量推断 AlphaTex 默认时值
 * 
 * 常见映射 (4/4 拍):
 *   4 slots → :4 (四分音符)
 *   8 slots → :8 (八分音符)
 *   16 slots → :16 (十六分音符)
 */
export function inferDuration(ts: TimeSignature, slotCount: number): number {
  const ticks = ticksPerSlot(ts, slotCount);
  return ticksToDuration(ticks);
}

/**
 * 检查 slot 数量是否能整除一小节
 * 如果不能整除，说明节奏型定义有问题
 */
export function validateSlotCount(ts: TimeSignature, slotCount: number): boolean {
  const total = ticksPerMeasure(ts);
  const perSlot = total / slotCount;
  // 检查是否为标准时值的整数倍
  return perSlot === Math.floor(perSlot) && perSlot >= 60;
}
