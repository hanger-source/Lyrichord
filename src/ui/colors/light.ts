/**
 * 明亮配色 — Tailwind Slate + Teal
 * 灵感: shadcn/ui light · Notion · Linear
 */
import type { ColorTokens } from '../theme';

export const lightColors: ColorTokens = {
  bgBase: '#f8fafc',
  bgSurface: '#ffffff',
  bgElevated: '#f1f5f9',
  bgInput: '#ffffff',
  bgHover: 'rgba(15,23,42,0.04)',

  border: '#e2e8f0',
  borderHover: '#cbd5e1',

  accent: '#0d9488',
  accentDim: 'rgba(13,148,136,0.10)',
  accentHover: '#0f766e',
  accentGlow: 'rgba(13,148,136,0.16)',
  accentText: '#ffffff',

  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',

  green: '#16a34a',
  greenDim: 'rgba(22,163,74,0.10)',
  orange: '#d97706',
  orangeDim: 'rgba(217,119,6,0.10)',
  red: '#dc2626',
  redDim: 'rgba(220,38,38,0.08)',
  cyan: '#0891b2',
  cyanDim: 'rgba(8,145,178,0.10)',

  cursorBar: 'rgba(13,148,136,0.08)',
  cursorBeat: 'rgba(13,148,136,0.50)',
  cursorHighlight: '#0d9488',

  chordBg: '#ffffff',
  chordGrid: '#94a3b8',
  chordNut: '#334155',
  chordText: '#334155',
  chordMute: '#dc2626',
  chordFinger1: '#0891b2',
  chordFinger2: '#16a34a',
  chordFinger3: '#d97706',
  chordFinger4: '#e11d48',
  chordDotDefault: '#334155',

  // TAB 编辑器
  beatGroupA: 'rgba(59, 130, 246, 0.06)',
  beatGroupB: 'rgba(245, 158, 11, 0.06)',
  beatSelBg: 'rgba(59, 130, 246, 0.18)',
  beatGroupBorder: 'rgba(0, 0, 0, 0.10)',
  splitColor: 'rgba(139, 92, 246, 0.50)',
  splitBg: 'rgba(139, 92, 246, 0.12)',
  splitBgAlt: 'rgba(139, 92, 246, 0.08)',
  splitDash: 'rgba(139, 92, 246, 0.30)',
  mergeColor: 'rgba(16, 185, 129, 0.50)',
  mergeBg: 'rgba(16, 185, 129, 0.12)',
  mergeBgAlt: 'rgba(16, 185, 129, 0.08)',
  mergeBar: 'rgba(16, 185, 129, 0.40)',
};
