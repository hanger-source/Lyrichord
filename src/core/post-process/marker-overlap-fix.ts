/**
 * AlphaTab Marker/Chord 重叠修复
 *
 * AlphaTab bug: section marker (段落名) 和 chord name 放在同一个
 * effect band slot（相同 Y 坐标），导致文字重叠。
 * 修复方式: 渲染完成后用 DOM 操作把 Marker + Tempo 整体上移。
 *
 * 识别方式:
 *   - 段落名: <text> 元素，bold Georgia 字体，左对齐
 *   - BPM: 同上但内容匹配 /=\s*\d/（如 "♩= 72"）
 *   - 音符符号: <g class="at"> 内的 Bravura 字体文本
 */

const SECTION_SHIFT = -32;  // 段落名偏移量 (px)
const TEMPO_SHIFT = -16;    // BPM/音符符号偏移

export function createMarkerOverlapFixer(container: () => HTMLDivElement | null): () => void {
  return () => {
    const el = container();
    if (!el) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const root = container();
        if (!root) return;
        fixTextElements(root);
        fixTempoGlyphs(root);
      }, 50);
    });
  };
}

function fixTextElements(root: HTMLDivElement): void {
  const texts = root.querySelectorAll('text');
  for (const t of texts) {
    if (t.hasAttribute('data-marker-fixed')) continue;
    const style = t.getAttribute('style') || '';
    const isBoldGeorgia = /\bbold\b/.test(style) && /Georgia/i.test(style);
    const isLeftAligned = !t.hasAttribute('text-anchor');
    if (isBoldGeorgia && isLeftAligned) {
      const content = t.textContent || '';
      const isTempo = /=\s*\d/.test(content);
      const shift = isTempo ? TEMPO_SHIFT : SECTION_SHIFT;
      const y = parseFloat(t.getAttribute('y') || '0');
      t.setAttribute('y', String(y + shift));
      t.setAttribute('data-marker-fixed', '1');
      t.setAttribute('data-marker-type', isTempo ? 'tempo' : 'section');
    }
  }
}

function fixTempoGlyphs(root: HTMLDivElement): void {
  const groups = root.querySelectorAll('g.at');
  for (const g of groups) {
    if (g.hasAttribute('data-marker-fixed')) continue;
    const transform = g.getAttribute('transform') || '';
    const match = transform.match(/translate\(\s*([\d.]+)\s+([\d.]+)\s*\)/);
    if (!match) continue;
    const innerText = g.querySelector('text');
    if (!innerText) continue;
    const innerStyle = innerText.getAttribute('style') || '';
    if (innerStyle.includes('Georgia') || innerStyle.includes('italic')) continue;
    const parentSvg = g.closest('svg');
    if (!parentSvg) continue;
    const tempoMarker = parentSvg.querySelector('text[data-marker-type="tempo"]');
    if (!tempoMarker) continue;
    const gY = parseFloat(match[2]);
    const markerY = parseFloat(tempoMarker.getAttribute('y') || '0') - TEMPO_SHIFT;
    if (Math.abs(gY - markerY) < 15) {
      const newY = gY + TEMPO_SHIFT;
      g.setAttribute('transform', `translate(${match[1]} ${newY})`);
      g.setAttribute('data-marker-fixed', '1');
    }
  }
}
