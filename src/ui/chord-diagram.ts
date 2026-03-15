/**
 * 和弦图 SVG 渲染器
 *
 * 绘制标准吉他和弦指法图:
 * - 6 弦 × 5 品格网格
 * - 手指位置圆点
 * - 空弦 (○) / 不弹 (×) 标记
 * - 横按 (barre) 弧线
 * - 和弦名称标题
 * - 起始品位标注（高把位和弦）
 */
import type { ChordDefinition, GuitarFrets } from '../core/types';

// ---- 布局常量 ----
const PADDING_TOP = 36;
const PADDING_LEFT = 28;
const PADDING_RIGHT = 12;
const PADDING_BOTTOM = 12;
const STRING_SPACING = 16;
const FRET_SPACING = 20;
const NUM_FRETS = 5;
const NUM_STRINGS = 6;
const DOT_RADIUS = 5.5;
const MARKER_Y = PADDING_TOP - 10;
const TITLE_Y = 14;

const WIDTH = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING + PADDING_RIGHT;
const HEIGHT = PADDING_TOP + NUM_FRETS * FRET_SPACING + PADDING_BOTTOM;

/**
 * 生成和弦图 SVG 字符串
 */
export function renderChordDiagram(chord: ChordDefinition): string {
  const frets = chord.frets;
  const startFret = chord.firstFret ?? detectStartFret(frets);
  const isOpenPosition = startFret <= 1;

  const parts: string[] = [];

  // SVG 开始
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" class="chord-diagram">`
  );

  // 背景
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#fff" rx="4"/>`);

  // 标题
  parts.push(
    `<text x="${WIDTH / 2}" y="${TITLE_Y}" text-anchor="middle" font-size="13" font-weight="bold" fill="#333">${escapeXml(chord.displayName)}</text>`
  );

  // 琴枕（开放把位时画粗线）
  if (isOpenPosition) {
    const x1 = PADDING_LEFT;
    const x2 = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING;
    parts.push(
      `<line x1="${x1}" y1="${PADDING_TOP}" x2="${x2}" y2="${PADDING_TOP}" stroke="#333" stroke-width="3"/>`
    );
  } else {
    // 高把位 → 显示起始品位
    parts.push(
      `<text x="${PADDING_LEFT - 8}" y="${PADDING_TOP + FRET_SPACING / 2 + 4}" text-anchor="end" font-size="10" fill="#666">${startFret}</text>`
    );
  }

  // 品格横线
  for (let f = 0; f <= NUM_FRETS; f++) {
    const y = PADDING_TOP + f * FRET_SPACING;
    const x1 = PADDING_LEFT;
    const x2 = PADDING_LEFT + (NUM_STRINGS - 1) * STRING_SPACING;
    parts.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#999" stroke-width="${f === 0 && !isOpenPosition ? 1 : 0.8}"/>`
    );
  }

  // 弦竖线
  for (let s = 0; s < NUM_STRINGS; s++) {
    const x = PADDING_LEFT + s * STRING_SPACING;
    const y1 = PADDING_TOP;
    const y2 = PADDING_TOP + NUM_FRETS * FRET_SPACING;
    parts.push(
      `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#999" stroke-width="0.8"/>`
    );
  }

  // 空弦 / 不弹标记 + 手指圆点
  for (let i = 0; i < NUM_STRINGS; i++) {
    const stringNum = 6 - i; // frets[0]=6弦, frets[5]=1弦
    const x = PADDING_LEFT + i * STRING_SPACING;
    const fret = frets[i];

    if (fret === -1) {
      // 不弹 ×
      parts.push(
        `<text x="${x}" y="${MARKER_Y}" text-anchor="middle" font-size="11" fill="#c00">×</text>`
      );
    } else if (fret === 0) {
      // 空弦 ○
      parts.push(
        `<circle cx="${x}" cy="${MARKER_Y - 4}" r="4" fill="none" stroke="#333" stroke-width="1.2"/>`
      );
    } else {
      // 按弦圆点
      const relativeFret = fret - (startFret <= 1 ? 0 : startFret - 1);
      if (relativeFret >= 1 && relativeFret <= NUM_FRETS) {
        const cy = PADDING_TOP + (relativeFret - 0.5) * FRET_SPACING;
        parts.push(
          `<circle cx="${x}" cy="${cy}" r="${DOT_RADIUS}" fill="#333"/>`
        );
      }
    }
  }

  // 横按 (barre)
  if (chord.barre) {
    const fromIdx = 6 - chord.barre.fromString;
    const toIdx = 6 - chord.barre.toString;
    const minIdx = Math.min(fromIdx, toIdx);
    const maxIdx = Math.max(fromIdx, toIdx);
    const relativeFret = chord.barre.fret - (startFret <= 1 ? 0 : startFret - 1);
    if (relativeFret >= 1 && relativeFret <= NUM_FRETS) {
      const cy = PADDING_TOP + (relativeFret - 0.5) * FRET_SPACING;
      const x1 = PADDING_LEFT + minIdx * STRING_SPACING;
      const x2 = PADDING_LEFT + maxIdx * STRING_SPACING;
      parts.push(
        `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" stroke="#333" stroke-width="${DOT_RADIUS * 2}" stroke-linecap="round"/>`
      );
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * 自动检测起始品位
 * 如果所有按弦品位都 > 4，则从最低品位开始显示
 */
function detectStartFret(frets: GuitarFrets): number {
  let min = Infinity;
  let max = 0;
  for (const f of frets) {
    if (f > 0) {
      min = Math.min(min, f);
      max = Math.max(max, f);
    }
  }
  if (min === Infinity) return 1;
  if (max <= NUM_FRETS) return 1;
  return min;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 创建和弦图 DOM 元素
 */
export function createChordDiagramElement(chord: ChordDefinition): HTMLElement {
  const div = document.createElement('div');
  div.className = 'chord-diagram-wrapper';
  div.innerHTML = renderChordDiagram(chord);
  return div;
}
