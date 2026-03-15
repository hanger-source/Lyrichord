/**
 * 力度 → AlphaTex 标记
 */
import { Dynamic } from '../types';

export function dynamicToAlphaTex(d: Dynamic): string {
  return `{${d}}`;
}
