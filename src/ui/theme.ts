/**
 * Lyrichord 主题 Token 系统
 *
 * 结构:
 *   theme.ts          — 接口定义 + 布局常量 + applyTheme()
 *   colors/light.ts   — 明亮配色方案
 *   colors/dark.ts    — 暗色配色方案
 *
 * 新增配色: 在 colors/ 下新建文件，实现 ColorTokens 接口即可。
 */

import { lightColors } from './colors/light';
import { darkColors } from './colors/dark';

/* ================================================
   接口定义
   ================================================ */

/** 配色 — 切换主题只改这部分 */
export interface ColorTokens {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgInput: string;
  bgHover: string;

  border: string;
  borderHover: string;

  accent: string;
  accentDim: string;
  accentHover: string;
  accentGlow: string;
  accentText: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  green: string;
  greenDim: string;
  orange: string;
  orangeDim: string;
  red: string;
  redDim: string;
  cyan: string;
  cyanDim: string;

  cursorBar: string;
  cursorBeat: string;
  cursorHighlight: string;

  chordBg: string;
  chordGrid: string;
  chordNut: string;
  chordText: string;
  chordMute: string;
  chordFinger1: string;
  chordFinger2: string;
  chordFinger3: string;
  chordFinger4: string;
  chordDotDefault: string;

  // TAB 编辑器
  beatGroupA: string;
  beatGroupB: string;
  beatSelBg: string;
  beatGroupBorder: string;
  splitColor: string;
  splitBg: string;
  splitBgAlt: string;
  splitDash: string;
  mergeColor: string;
  mergeBg: string;
  mergeBgAlt: string;
  mergeBar: string;
}

/** 布局 — 全局共享，不随主题切换 */
export interface LayoutTokens {
  radius: string;
  radiusSm: string;
  shadowSm: string;
  shadowMd: string;
  transition: string;
  fontBase: string;
  fontSm: string;
  fontXs: string;
  fontLg: string;
  fontXl: string;
  fontMono: string;
  spaceXs: string;
  spaceSm: string;
  spaceMd: string;
  spaceLg: string;
  spaceXl: string;
  headerHeight: string;
  toolbarHeight: string;
  sidebarWidth: string;
}

/** 完整主题 = 配色 + 布局 */
export type ThemeTokens = ColorTokens & LayoutTokens;

/* ================================================
   全局布局（与配色无关）
   ================================================ */

export const layout: LayoutTokens = {
  radius: '8px',
  radiusSm: '6px',
  shadowSm: '0 1px 2px rgba(0,0,0,0.05)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.07)',
  transition: '0.15s ease',
  fontBase: '15px',
  fontSm: '13px',
  fontXs: '12px',
  fontLg: '17px',
  fontXl: '20px',
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  spaceXs: '4px',
  spaceSm: '8px',
  spaceMd: '12px',
  spaceLg: '16px',
  spaceXl: '20px',
  headerHeight: '56px',
  toolbarHeight: '46px',
  sidebarWidth: '360px',
};

/* ================================================
   组合导出
   ================================================ */

function merge(colors: ColorTokens, l: LayoutTokens): ThemeTokens {
  return { ...colors, ...l };
}

export const lightTheme: ThemeTokens = merge(lightColors, layout);
export const darkTheme: ThemeTokens = merge(darkColors, layout);

/** 便于外部直接 import 配色做扩展 */
export { lightColors, darkColors };

/* ================================================
   注入 CSS 变量
   ================================================ */

export function applyTheme(t: ThemeTokens): void {
  const s = document.documentElement.style;

  // 配色
  s.setProperty('--bg-base', t.bgBase);
  s.setProperty('--bg-surface', t.bgSurface);
  s.setProperty('--bg-elevated', t.bgElevated);
  s.setProperty('--bg-input', t.bgInput);
  s.setProperty('--bg-hover', t.bgHover);
  s.setProperty('--border', t.border);
  s.setProperty('--border-hover', t.borderHover);
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent-dim', t.accentDim);
  s.setProperty('--accent-hover', t.accentHover);
  s.setProperty('--accent-glow', t.accentGlow);
  s.setProperty('--accent-text', t.accentText);
  s.setProperty('--text-primary', t.textPrimary);
  s.setProperty('--text-secondary', t.textSecondary);
  s.setProperty('--text-muted', t.textMuted);
  s.setProperty('--green', t.green);
  s.setProperty('--green-dim', t.greenDim);
  s.setProperty('--orange', t.orange);
  s.setProperty('--orange-dim', t.orangeDim);
  s.setProperty('--red', t.red);
  s.setProperty('--red-dim', t.redDim);
  s.setProperty('--cyan', t.cyan);
  s.setProperty('--cyan-dim', t.cyanDim);
  s.setProperty('--cursor-bar', t.cursorBar);
  s.setProperty('--cursor-beat', t.cursorBeat);
  s.setProperty('--cursor-highlight', t.cursorHighlight);
  s.setProperty('--chord-bg', t.chordBg);
  s.setProperty('--chord-grid', t.chordGrid);
  s.setProperty('--chord-nut', t.chordNut);
  s.setProperty('--chord-text', t.chordText);
  s.setProperty('--chord-mute', t.chordMute);
  s.setProperty('--chord-finger1', t.chordFinger1);
  s.setProperty('--chord-finger2', t.chordFinger2);
  s.setProperty('--chord-finger3', t.chordFinger3);
  s.setProperty('--chord-finger4', t.chordFinger4);
  s.setProperty('--chord-dot-default', t.chordDotDefault);

  // TAB 编辑器
  s.setProperty('--beat-group-a', t.beatGroupA);
  s.setProperty('--beat-group-b', t.beatGroupB);
  s.setProperty('--beat-sel-bg', t.beatSelBg);
  s.setProperty('--beat-group-border', t.beatGroupBorder);
  s.setProperty('--split-color', t.splitColor);
  s.setProperty('--split-bg', t.splitBg);
  s.setProperty('--split-bg-alt', t.splitBgAlt);
  s.setProperty('--split-dash', t.splitDash);
  s.setProperty('--merge-color', t.mergeColor);
  s.setProperty('--merge-bg', t.mergeBg);
  s.setProperty('--merge-bg-alt', t.mergeBgAlt);
  s.setProperty('--merge-bar', t.mergeBar);

  // 布局
  s.setProperty('--radius', t.radius);
  s.setProperty('--radius-sm', t.radiusSm);
  s.setProperty('--shadow-sm', t.shadowSm);
  s.setProperty('--shadow-md', t.shadowMd);
  s.setProperty('--transition', t.transition);
  s.setProperty('--font-base', t.fontBase);
  s.setProperty('--font-sm', t.fontSm);
  s.setProperty('--font-xs', t.fontXs);
  s.setProperty('--font-lg', t.fontLg);
  s.setProperty('--font-xl', t.fontXl);
  s.setProperty('--font-mono', t.fontMono);
  s.setProperty('--space-xs', t.spaceXs);
  s.setProperty('--space-sm', t.spaceSm);
  s.setProperty('--space-md', t.spaceMd);
  s.setProperty('--space-lg', t.spaceLg);
  s.setProperty('--space-xl', t.spaceXl);
  s.setProperty('--header-height', t.headerHeight);
  s.setProperty('--toolbar-height', t.toolbarHeight);
  s.setProperty('--sidebar-width', t.sidebarWidth);
}
