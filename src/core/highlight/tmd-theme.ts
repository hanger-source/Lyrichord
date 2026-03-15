/**
 * TMD 语法高亮主题 — CodeMirror 6 HighlightStyle
 *
 * 颜色方案基于项目的 CSS 变量色板。
 *
 * 扩展方式：
 *   - 新增 token 类型的颜色 → 在 tmdHighlightStyle 数组里加一条
 *   - 修改颜色 → 改对应的 color 值
 *   - 自定义 Tag → 从 tmd-language.ts 导入
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { tmdRhythmDef, tmdSegmentRef, tmdAtRef } from './tmd-language';

/**
 * TMD 高亮样式
 *
 * 标准 Tag:
 *   processingInstruction  → 灰色加粗 (--- 分隔符)
 *   keyword                → 紫色 (meta key, define, pluck/strum)
 *   string                 → 绿色 (meta value, 歌词, pattern)
 *   heading                → 橙色加粗 ([SectionName])
 *   typeName               → 蓝色 (和弦名 [C], Am)
 *   bracket                → 灰色 (|, {})
 *   operator               → 灰色 (., ~, r.4 休止)
 *   number                 → 橙色 (数字, tex beat)
 *   labelName              → 紫色 (w:, w2:, tex:)
 *   comment                → 灰色斜体 (# 注释)
 *   punctuation            → 灰色 (:)
 *
 * 自定义 Tag:
 *   tmdRhythmDef           → 蓝色 (@R1: 节奏型定义名)
 *   tmdSegmentRef          → 青色 (@segment(Name) 引用)
 *   tmdAtRef               → 青色 (@R1 节奏型引用)
 */
const tmdHighlightStyle = HighlightStyle.define([
  // 标准 tags
  { tag: tags.processingInstruction, color: '#6b7280', fontWeight: 'bold' },
  { tag: tags.keyword, color: '#8b5cf6' },
  { tag: tags.string, color: '#16a34a' },
  { tag: tags.heading, color: '#d97706', fontWeight: 'bold' },
  { tag: tags.typeName, color: '#2563eb', fontWeight: '500' },
  { tag: tags.bracket, color: '#9ca3af' },
  { tag: tags.operator, color: '#9ca3af' },
  { tag: tags.number, color: '#d97706' },
  { tag: tags.labelName, color: '#8b5cf6', fontWeight: '500' },
  { tag: tags.comment, color: '#9ca3af', fontStyle: 'italic' },
  { tag: tags.punctuation, color: '#9ca3af' },
  // TMD 自定义 tags
  { tag: tmdRhythmDef, color: '#2563eb', fontWeight: '500' },
  { tag: tmdSegmentRef, color: '#0891b2', fontWeight: '500' },
  { tag: tmdAtRef, color: '#0891b2', fontWeight: '500' },
]);

/** 导出为 CodeMirror extension */
export const tmdHighlight = syntaxHighlighting(tmdHighlightStyle);
