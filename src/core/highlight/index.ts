/**
 * TMD 语法高亮入口
 *
 * 导出一个 CodeMirror extension 数组，包含：
 *   - tmdLanguage: StreamLanguage tokenizer（语法解析）
 *   - tmdHighlight: HighlightStyle（颜色映射）
 *
 * 使用方式：
 *   import { tmdExtensions } from '../../core/highlight';
 *   // 在 EditorState.create 的 extensions 里加入 ...tmdExtensions
 *
 * 扩展方式：
 *   - 新增 token 类型 → tmd-language.ts
 *   - 修改颜色 → tmd-theme.ts
 *   - 加 rainbow bracket 等 → 在这里加新 extension
 */
import type { Extension } from '@codemirror/state';
import { tmdLanguage } from './tmd-language';
import { tmdHighlight } from './tmd-theme';
import { tmdDecorations, tmdDecorationTheme } from './tmd-decorations';

export { tmdLanguage } from './tmd-language';
export { tmdHighlight } from './tmd-theme';
export { tmdDecorations, tmdDecorationTheme } from './tmd-decorations';

/** 一次性导入所有 TMD 高亮相关 extension */
export const tmdExtensions: Extension[] = [
  tmdLanguage,
  tmdHighlight,
  tmdDecorations,
  tmdDecorationTheme,
];
