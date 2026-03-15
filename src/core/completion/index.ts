/**
 * TMD 智能补全入口
 *
 * 导出一个 createTmdCompletion() 工厂函数，
 * 接收外部数据的 ref，返回 CodeMirror 6 的 CompletionSource。
 *
 * 内部逻辑：
 *   1. 判断光标在 header 还是 body（通过扫描 --- 分隔符）
 *   2. 构建 TmdCompletionContext
 *   3. 按顺序调用 providers，第一个返回非 null 的胜出
 *
 * 扩展方式：
 *   - 新增补全规则 → 在 providers.ts 里加 provider
 *   - 新增数据源 → 在 types.ts 的 CompletionData 里加字段
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { CompletionData, TmdZone, TmdCompletionContext } from './types';
import { providers } from './providers';

export type { CompletionData } from './types';
export type { TmdCompletionProvider } from './types';

/**
 * 判断光标所在区域：header 还是 body
 *
 * 规则：第一个 --- 和第二个 --- 之间是 header，其余是 body
 */
function detectZone(doc: string, pos: number): TmdZone {
  let delimCount = 0;
  let i = 0;
  while (i < doc.length && i < pos) {
    // 检查行首的 ---
    if (i === 0 || doc[i - 1] === '\n') {
      if (doc.slice(i, i + 3) === '---' && (i + 3 >= doc.length || doc[i + 3] === '\n' || doc[i + 3] === '\r')) {
        delimCount++;
        if (delimCount === 2 && pos > i) return 'body';
      }
    }
    i++;
  }
  // 在第一个 --- 之后、第二个 --- 之前 → header
  return delimCount === 1 ? 'header' : 'body';
}

/**
 * 创建 TMD 补全函数
 *
 * @param dataRef - 外部数据的 ref（React ref 或普通对象），内容会实时读取
 */
export function createTmdCompletion(
  dataRef: { current: CompletionData }
): (ctx: CompletionContext) => CompletionResult | null {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const lineText = line.text;
    const colOffset = ctx.pos - line.from;
    const textBefore = lineText.slice(0, colOffset);
    const fullDoc = ctx.state.doc.toString();
    const zone = detectZone(fullDoc, ctx.pos);

    const tmdCtx: TmdCompletionContext = {
      lineText,
      colOffset,
      textBefore,
      pos: ctx.pos,
      lineFrom: line.from,
      zone,
      data: dataRef.current,
    };

    // 按顺序尝试每个 provider
    for (const provider of providers) {
      const result = provider.complete(tmdCtx);
      if (result) return result;
    }

    return null;
  };
}
