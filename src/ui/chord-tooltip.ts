/**
 * 和弦图 Hover Tooltip
 *
 * 监听曲谱区域的和弦名称元素，hover 时弹出和弦指法图。
 * 同时支持编辑器中的和弦名称 hover。
 */
import type { ChordDefinition } from '../core/types';
import { renderChordDiagram } from './chord-diagram';
import { resolveChord } from '../core/chord/resolver';

let tooltipEl: HTMLElement | null = null;
let currentChordId: string | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** 和弦缓存（避免重复解析） */
const chordCache = new Map<string, ChordDefinition | null>();

/**
 * 初始化 tooltip 系统
 *
 * 创建全局 tooltip 容器，绑定事件委托。
 */
export function initChordTooltip(container: HTMLElement): void {
  // 创建 tooltip 容器
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'chord-tooltip';
    tooltipEl.style.cssText = `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      filter: drop-shadow(0 2px 8px rgba(0,0,0,0.15));
    `;
    document.body.appendChild(tooltipEl);
  }

  // 事件委托: mouseover / mouseout
  container.addEventListener('mouseover', handleMouseOver);
  container.addEventListener('mouseout', handleMouseOut);
}

/**
 * 手动显示某个和弦的 tooltip
 */
export function showChordTooltip(chordId: string, anchorRect: DOMRect): void {
  if (!tooltipEl) return;
  if (chordId === currentChordId && tooltipEl.style.opacity === '1') return;

  const chord = getCachedChord(chordId);
  if (!chord) return;

  currentChordId = chordId;
  tooltipEl.innerHTML = renderChordDiagram(chord);
  tooltipEl.style.opacity = '1';
  positionTooltip(anchorRect);
}

/**
 * 隐藏 tooltip
 */
export function hideChordTooltip(): void {
  if (!tooltipEl) return;
  tooltipEl.style.opacity = '0';
  currentChordId = null;
}

/**
 * 销毁 tooltip 系统
 */
export function destroyChordTooltip(): void {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
  chordCache.clear();
}

/**
 * 清除和弦缓存（和弦库更新后调用）
 */
export function clearChordCache(): void {
  chordCache.clear();
}

// ---- 内部实现 ----

function getCachedChord(chordId: string): ChordDefinition | null {
  if (chordCache.has(chordId)) return chordCache.get(chordId)!;
  const chord = resolveChord(chordId);
  chordCache.set(chordId, chord);
  return chord;
}

/**
 * 事件委托: mouseover
 *
 * AlphaTab 渲染的和弦名称元素带有特定 class，
 * 我们通过 data-chord 属性或文本内容识别和弦。
 *
 * 同时支持自定义 [data-chord] 属性的任意元素。
 */
function handleMouseOver(e: Event): void {
  const target = e.target as HTMLElement;
  if (!target) return;

  // 方式1: 自定义 data-chord 属性
  const chordId = target.dataset?.chord ?? target.closest('[data-chord]')?.getAttribute('data-chord');
  if (chordId) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const rect = target.getBoundingClientRect();
    showChordTooltip(chordId, rect);
    return;
  }

  // 方式2: AlphaTab 渲染的和弦文本 (class="at-chord-name" 或类似)
  const chordEl = target.closest('.at-chord-name, [class*="chord"]');
  if (chordEl) {
    const text = chordEl.textContent?.trim();
    if (text && /^[A-G]/.test(text)) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      const rect = chordEl.getBoundingClientRect();
      showChordTooltip(text, rect);
    }
  }
}

function handleMouseOut(e: Event): void {
  const target = e.target as HTMLElement;
  if (!target) return;

  const isChordEl = target.dataset?.chord
    || target.closest('[data-chord]')
    || target.closest('.at-chord-name, [class*="chord"]');

  if (isChordEl) {
    // 延迟隐藏，避免鼠标在元素间移动时闪烁
    hideTimer = setTimeout(() => {
      hideChordTooltip();
      hideTimer = null;
    }, 200);
  }
}

function positionTooltip(anchorRect: DOMRect): void {
  if (!tooltipEl) return;

  // 默认显示在元素上方
  const tooltipWidth = 140;
  const tooltipHeight = 160;

  let left = anchorRect.left + anchorRect.width / 2 - tooltipWidth / 2;
  let top = anchorRect.top - tooltipHeight - 8;

  // 边界检测: 上方空间不够 → 显示在下方
  if (top < 4) {
    top = anchorRect.bottom + 8;
  }

  // 左右边界
  if (left < 4) left = 4;
  if (left + tooltipWidth > window.innerWidth - 4) {
    left = window.innerWidth - tooltipWidth - 4;
  }

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}
