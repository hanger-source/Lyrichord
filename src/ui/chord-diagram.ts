/**
 * 和弦图 SVG 渲染器
 *
 * 绘制标准吉他和弦指法图:
 * - 6 弦 × 5 品格网格
 * - 手指位置圆点（按手指编号着色）
 * - 空弦 (○) / 不弹 (×) 标记
 * - 横按 (barre) 弧线
 * - 和弦名称标题
 * - 左侧品位号标注
 * - 下方音名标注
 */
import type { ChordDefinition, GuitarFrets } from '../core/types';

// ---- 布局常量 ----
const PADDING_TOP = 42;
const PADDING_LEFT = 34;
const PADDING_RIGHT = 16;
const PADDING_BOTTOM = 28;
const STRING_SPACING = 20;
const FRET_SPACING = 24;
const NUM_FRETS = 5;
const NUM_STRINGS = 6;
const DOT_RADIUS = 7;
const MARKER_Y = PADDING_TOP - 12;
const TITLE_Y = 16;

const WIDTH = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING + PADDING_RIGHT;
const HEIGHT = PADDING_TOP + NUM_FRETS * FRET_SPACING + PADDING_BOTTOM;

/** 从 CSS 变量读取颜色（运行时走主题系统） */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function getFingerColor(finger: number): string {
  switch (finger) {
    case 1: return cssVar('--chord-finger1', '#0891b2');
    case 2: return cssVar('--chord-finger2', '#16a34a');
    case 3: return cssVar('--chord-finger3', '#d97706');
    case 4: return cssVar('--chord-finger4', '#e11d48');
    default: return cssVar('--chord-dot-default', '#334155');
  }
}

function getDotDefault(): string { return cssVar('--chord-dot-default', '#334155'); }
function getGridColor(): string { return cssVar('--chord-grid', '#94a3b8'); }
function getNutColor(): string { return cssVar('--chord-nut', '#334155'); }
function getTextColor(): string { return cssVar('--chord-text', '#334155'); }
function getMuteColor(): string { return cssVar('--chord-mute', '#dc2626'); }
function getBgColor(): string { return cssVar('--chord-bg', '#ffffff'); }

/**
 * 生成和弦图 SVG 字符串
 */
export function renderChordDiagram(chord: ChordDefinition): string {
  const fingers = chord.fingers;
  // 优先从 positions 取相对品位（用于网格渲染）
  // chord.frets 现在存的是绝对品位（供 voicing/AlphaTex 用）
  const pos = chord.positions?.[chord.selectedPosition ?? 0];
  const frets = pos ? pos.frets : chord.frets;
  const baseFret = pos ? pos.baseFret : (chord.firstFret ?? detectStartFret(chord.frets));
  const isOpenPosition = baseFret <= 1;
  const barres = pos?.barres ?? [];

  const parts: string[] = [];
  const gridColor = getGridColor();
  const nutColor = getNutColor();
  const textColor = getTextColor();
  const muteColor = getMuteColor();
  const bgColor = getBgColor();
  const dotDefault = getDotDefault();

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" class="chord-diagram">`
  );
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${bgColor}" rx="4"/>`);

  // 标题
  parts.push(
    `<text x="${WIDTH / 2}" y="${TITLE_Y}" text-anchor="middle" font-size="15" font-weight="bold" fill="${textColor}">${escapeXml(chord.displayName)}</text>`
  );

  // 琴枕（开放把位时画粗线）
  if (isOpenPosition) {
    const x1 = PADDING_LEFT;
    const x2 = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING;
    parts.push(
      `<line x1="${x1}" y1="${PADDING_TOP}" x2="${x2}" y2="${PADDING_TOP}" stroke="${nutColor}" stroke-width="3"/>`
    );
  }

  // 品格横线
  for (let f = 0; f <= NUM_FRETS; f++) {
    const y = PADDING_TOP + f * FRET_SPACING;
    const x1 = PADDING_LEFT;
    const x2 = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING;
    parts.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${gridColor}" stroke-width="${f === 0 && !isOpenPosition ? 1 : 0.8}"/>`
    );
  }

  // 弦竖线
  for (let s = 0; s < NUM_STRINGS; s++) {
    const x = PADDING_LEFT + s * STRING_SPACING;
    parts.push(
      `<line x1="${x}" y1="${PADDING_TOP}" x2="${x}" y2="${PADDING_TOP + NUM_FRETS * FRET_SPACING}" stroke="${gridColor}" stroke-width="0.8"/>`
    );
  }

  // 横按 (barre)
  for (const barreFret of barres) {
    const barreFingerIdx = fingers ? frets.indexOf(barreFret) : -1;
    const barreFinger = barreFingerIdx >= 0 && fingers ? fingers[barreFingerIdx] : 0;
    let minIdx = NUM_STRINGS;
    let maxIdx = -1;
    for (let i = 0; i < NUM_STRINGS; i++) {
      if (frets[i] === barreFret && (!fingers || fingers[i] === barreFinger)) {
        minIdx = Math.min(minIdx, i);
        maxIdx = Math.max(maxIdx, i);
      }
    }
    if (minIdx < maxIdx) {
      const relativeFret = barreFret;
      if (relativeFret >= 1 && relativeFret <= NUM_FRETS) {
        const cy = PADDING_TOP + (relativeFret - 0.5) * FRET_SPACING;
        const x1 = PADDING_LEFT + minIdx * STRING_SPACING;
        const x2 = PADDING_LEFT + maxIdx * STRING_SPACING;
        const color = barreFinger > 0 ? getFingerColor(barreFinger) : dotDefault;
        parts.push(
          `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="${color}" stroke-width="${DOT_RADIUS * 2}" stroke-linecap="round" opacity="0.7"/>`
        );
      }
    }
  }

  // 空弦 / 不弹标记 + 手指圆点
  for (let i = 0; i < NUM_STRINGS; i++) {
    const x = PADDING_LEFT + i * STRING_SPACING;
    const fret = frets[i];
    const finger = fingers ? fingers[i] : 0;

    if (fret === -1) {
      parts.push(
        `<text x="${x}" y="${MARKER_Y}" text-anchor="middle" font-size="13" fill="${muteColor}">×</text>`
      );
    } else if (fret === 0) {
      parts.push(
        `<circle cx="${x}" cy="${MARKER_Y - 4}" r="5" fill="none" stroke="${nutColor}" stroke-width="1.4"/>`
      );
    } else {
      const relativeFret = pos ? fret : (fret - (baseFret <= 1 ? 0 : baseFret - 1));
      if (relativeFret >= 1 && relativeFret <= NUM_FRETS) {
        const cy = PADDING_TOP + (relativeFret - 0.5) * FRET_SPACING;
        const color = finger > 0 ? getFingerColor(finger) : dotDefault;
        parts.push(
          `<circle cx="${x}" cy="${cy}" r="${DOT_RADIUS}" fill="${color}"/>`
        );
        if (finger > 0) {
          parts.push(
            `<text x="${x}" y="${cy + 4}" text-anchor="middle" font-size="10" font-weight="bold" fill="#fff">${finger}</text>`
          );
        }
      }
    }
  }

  // 左侧品位号
  const fretLabelColor = cssVar('--text-muted', '#94a3b8');
  const fretBase = baseFret <= 1 ? 1 : baseFret;
  for (let f = 1; f <= NUM_FRETS; f++) {
    const fretNum = fretBase + f - 1;
    const cy = PADDING_TOP + (f - 0.5) * FRET_SPACING;
    parts.push(
      `<text x="${PADDING_LEFT - 10}" y="${cy + 4}" text-anchor="end" font-size="10" fill="${fretLabelColor}">${fretNum}</text>`
    );
  }

  // 下方音名
  const noteColor = cssVar('--text-secondary', '#475569');
  const noteLabelY = PADDING_TOP + NUM_FRETS * FRET_SPACING + 14;
  for (let i = 0; i < NUM_STRINGS; i++) {
    const x = PADDING_LEFT + i * STRING_SPACING;
    const fret = frets[i];
    if (fret < 0) continue;
    // 实际品位: pos 存在时 = fret + baseFret - 1; 无 pos 时 fret 本身就是绝对品位
    const actualFret = pos ? (fret === 0 ? 0 : fret + baseFret - 1) : fret;
    const noteName = fretToNoteName(i, actualFret);
    parts.push(
      `<text x="${x}" y="${noteLabelY}" text-anchor="middle" font-size="10" fill="${noteColor}">${noteName}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ---- 工具函数 ----

const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function fretToNoteName(stringIdx: number, actualFret: number): string {
  const midi = OPEN_STRING_MIDI[stringIdx] + actualFret;
  return NOTE_NAMES[midi % 12];
}

function detectStartFret(frets: GuitarFrets): number {
  let min = Infinity;
  let max = 0;
  for (const f of frets) {
    if (f > 0) { min = Math.min(min, f); max = Math.max(max, f); }
  }
  if (min === Infinity) return 1;
  if (max <= NUM_FRETS) return 1;
  return min;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createChordDiagramElement(chord: ChordDefinition): HTMLElement {
  const div = document.createElement('div');
  div.className = 'chord-diagram-wrapper';
  div.innerHTML = renderChordDiagram(chord);
  return div;
}
