/**
 * TMD 智能补全类型定义
 *
 * 可扩展的 provider 模式：
 *   1. 实现 TmdCompletionProvider 接口
 *   2. 在 index.ts 的 providers 数组里注册
 *   3. 完成 — 新语法的补全自动生效
 *
 * 每个 provider 负责判断"当前光标位置是否属于我"，
 * 如果是，返回候选项；如果不是，返回 null。
 */
import type { EditorView } from '@codemirror/view';
import type { Completion, CompletionResult } from '@codemirror/autocomplete';

/** 外部数据源 — 由 UI 层注入，provider 只读 */
export interface CompletionData {
  /** DB 和弦库的所有和弦名 */
  chordNames: string[];
  /** DB 节奏型库的所有 ID（如 S8-abc12, P8-6x7p3） */
  rhythmIds: string[];
  /** TAB 段落名列表 */
  segmentNames: string[];
}

/** 光标所在的文档区域 */
export type TmdZone = 'header' | 'body';

/** 传给 provider 的上下文 */
export interface TmdCompletionContext {
  /** 光标所在行的完整文本 */
  lineText: string;
  /** 光标在行内的偏移（0-based） */
  colOffset: number;
  /** 光标前的文本（lineText 的 [0, colOffset] 切片） */
  textBefore: string;
  /** 光标在文档中的绝对位置 */
  pos: number;
  /** 行起始的绝对位置 */
  lineFrom: number;
  /** 当前所在区域 */
  zone: TmdZone;
  /** 外部数据 */
  data: CompletionData;
}

/**
 * TMD 补全 Provider 接口
 *
 * 每个 provider 处理一种上下文场景。
 * 返回 CompletionResult 表示"我能处理"，返回 null 表示"不是我的场景"。
 */
export interface TmdCompletionProvider {
  /** 唯一标识，调试用 */
  id: string;
  /** 尝试提供补全。返回 null 表示不匹配当前上下文 */
  complete(ctx: TmdCompletionContext): CompletionResult | null;
}
