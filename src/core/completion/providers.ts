/**
 * TMD 补全 Provider 集合
 *
 * 每个 provider 处理一种上下文场景。
 * 要添加新的补全规则，在这里写一个新 provider 并在底部 export。
 *
 * Provider 执行顺序 = 数组顺序，第一个返回非 null 的胜出。
 * 所以更具体的 provider 放前面，更通用的放后面。
 */
import { startCompletion, type Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { TmdCompletionProvider } from './types';

// ============================================================
// Header 区域 providers
// ============================================================

/** Header 内行首 — meta key 候选 */
const headerMetaKey: TmdCompletionProvider = {
  id: 'header-meta-key',
  complete(ctx) {
    if (ctx.zone !== 'header') return null;
    // 已经是 @（节奏型定义）或 define（和弦定义）→ 交给其他 provider
    if (ctx.textBefore.startsWith('@') || ctx.textBefore.startsWith('define')) return null;
    // 行首或正在输入 key 名
    const m = ctx.textBefore.match(/^(\w*)$/);
    if (!m) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length;
    const keys = [
      { label: 'title:', detail: '曲名', type: 'keyword' as const },
      { label: 'artist:', detail: '艺术家', type: 'keyword' as const },
      { label: 'tempo:', detail: 'BPM 速度', type: 'keyword' as const },
      { label: 'time_signature:', detail: '拍号 (如 4/4)', type: 'keyword' as const },
      { label: 'capo:', detail: '变调夹品位', type: 'keyword' as const },
    ];
    return { from, options: keys.map(k => ({ ...k, apply: k.label + ' ' })), filter: true };
  },
};

/** Header 内 @ 开头 — 节奏型定义模板 */
const headerRhythmDef: TmdCompletionProvider = {
  id: 'header-rhythm-def',
  complete(ctx) {
    if (ctx.zone !== 'header') return null;
    const m = ctx.textBefore.match(/^@(\w*)$/);
    if (!m) return null;
    const from = ctx.pos - m[0].length;
    const options: Completion[] = [
      {
        label: '@R1: pluck()',
        type: 'function',
        detail: '拨弦节奏型',
        apply: applyWithCursor('@R1: pluck(', ')'),
      },
      {
        label: '@R1: strum()',
        type: 'function',
        detail: '扫弦节奏型',
        apply: applyWithCursor('@R1: strum(', ')'),
      },
    ];
    return { from, options, filter: true };
  },
};

/** Header 内 define 开头 — 和弦定义模板 */
const headerChordDef: TmdCompletionProvider = {
  id: 'header-chord-def',
  complete(ctx) {
    if (ctx.zone !== 'header') return null;
    const m = ctx.textBefore.match(/^(d|de|def|defi|defin|define)$/);
    if (!m) return null;
    const from = ctx.pos - m[0].length;
    return {
      from,
      options: [{
        label: 'define []: { frets: "" }',
        type: 'function',
        detail: '自定义和弦指法',
        apply: applyWithCursor('define [', ']: { frets: "" }'),
      }],
      filter: true,
    };
  },
};

// ============================================================
// Body 区域 providers
// ============================================================

/** 行首空行 — body 行类型候选 */
const bodyLineStart: TmdCompletionProvider = {
  id: 'body-line-start',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    // 只在行首（空或刚开始输入）
    const m = ctx.textBefore.match(/^(\S{0,4})$/);
    if (!m) return null;
    const prefix = m[1];
    // 如果已经匹配到更具体的 provider（如 [ 或 @ 或 |），不在这里处理
    if (prefix.startsWith('[') || prefix.startsWith('@') || prefix.startsWith('|') || prefix.startsWith('#')) return null;
    const from = ctx.pos - prefix.length;
    const options: Completion[] = [
      { label: '[', type: 'keyword', detail: '段落标记 [Name]', apply: applyWithCursor('[', ']') },
      { label: '|', type: 'keyword', detail: '小节行 | C . D . |' },
      { label: 'w:', type: 'keyword', detail: '歌词行', apply: 'w: ' },
      { label: 'w2:', type: 'keyword', detail: '第二段歌词', apply: 'w2: ' },
      { label: 'tex:', type: 'keyword', detail: '精确 AlphaTex 音符', apply: 'tex: ' },
      { label: '#', type: 'keyword', detail: '注释', apply: '# ' },
      { label: '@segment()', type: 'function', detail: '引用 TAB 段落', apply: applyWithCursor('@segment(', ')') },
    ];
    return { from, options, filter: true };
  },
};

/** 段落标记 [ 后 — 段落名 + 自动闭合 ] */
const sectionName: TmdCompletionProvider = {
  id: 'section-name',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    const m = ctx.textBefore.match(/^\[([^\]]*)$/);
    if (!m) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length;
    const textAfter = ctx.lineText.slice(ctx.colOffset);
    const hasCloseBracket = textAfter.startsWith(']');
    // 常用段落名候选
    const builtinNames = ['Intro', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'C1', 'C2', 'Interlude', 'Outro', 'Bridge', 'Solo'];
    const options: Completion[] = builtinNames.map(name => ({
      label: name,
      type: 'enum',
      apply: (view: EditorView, _c: Completion, f: number, t: number) => {
        const to = hasCloseBracket ? t + 1 : t;
        view.dispatch({
          changes: { from: f, to, insert: name + ']' },
        });
      },
    }));
    return { from, options, filter: true };
  },
};

/** 段落标记 ] 后空格 — 节奏型引用 @R1 */
const sectionRhythmRef: TmdCompletionProvider = {
  id: 'section-rhythm-ref',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    // [Name] 后面，可能已经输入了 @
    const m = ctx.textBefore.match(/\]\s+@?(\w*)$/);
    if (!m) return null;
    if (ctx.data.rhythmIds.length === 0) return null;
    const hasAt = ctx.textBefore.match(/\]\s+@(\w*)$/);
    const prefix = hasAt ? hasAt[1] : m[1];
    const from = hasAt ? ctx.pos - prefix.length - 1 : ctx.pos - prefix.length;
    const options: Completion[] = ctx.data.rhythmIds.map(id => ({
      label: `@${id}`,
      type: 'variable',
      detail: '节奏型引用',
    }));
    return { from, options, filter: true };
  },
};

/** 小节行内 @ 后 — 节奏型引用候选 (C@R1 格式) */
const measureRhythmRef: TmdCompletionProvider = {
  id: 'measure-rhythm-ref',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    if (!ctx.lineText.trimStart().startsWith('|')) return null;
    // 匹配和弦名后面的 @，如 "C@" 或 "Am@R"
    const m = ctx.textBefore.match(/@(\w*)$/);
    if (!m) return null;
    if (ctx.data.rhythmIds.length === 0) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length - 1; // 包含 @
    const options: Completion[] = ctx.data.rhythmIds.map(id => ({
      label: `@${id}`,
      type: 'variable',
      detail: '节奏型引用',
    }));
    return { from, options, filter: true };
  },
};

/** 小节行内 — 和弦名候选 */
const measureChord: TmdCompletionProvider = {
  id: 'measure-chord',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    // 行以 | 开头，光标在小节行内
    if (!ctx.lineText.trimStart().startsWith('|')) return null;
    // 当前正在输入的 token（空格分隔）
    const m = ctx.textBefore.match(/(?:^|\s)([A-Ga-g#b/]*)$/);
    if (!m || m[1].length === 0) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length;
    const options: Completion[] = ctx.data.chordNames.map(name => ({
      label: name,
      type: 'variable',
      detail: '和弦',
    }));
    return { from, options, filter: true };
  },
};

/** 歌词行 / tex 行内 [ 后 — 和弦名候选 + 自动闭合 ] */
const inlineChordMark: TmdCompletionProvider = {
  id: 'inline-chord-mark',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    // 行以 w: / w2: / tex: 开头
    const lineStart = ctx.lineText.trimStart();
    if (!lineStart.startsWith('w:') && !lineStart.startsWith('w2:') && !lineStart.startsWith('tex:')) return null;
    // 光标在 [ 后面，还没闭合
    const m = ctx.textBefore.match(/\[([^\]]*)$/);
    if (!m) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length;
    const textAfter = ctx.lineText.slice(ctx.colOffset);
    const hasCloseBracket = textAfter.startsWith(']');
    const options: Completion[] = ctx.data.chordNames.map(name => ({
      label: name,
      type: 'variable',
      detail: '和弦标记',
      apply: (view: EditorView, _c: Completion, f: number, t: number) => {
        const to = hasCloseBracket ? t + 1 : t;
        view.dispatch({
          changes: { from: f, to, insert: name + ']' },
        });
      },
    }));
    return { from, options, filter: true };
  },
};

/** @segment( 内部 — 段落名候选 */
const segmentRef: TmdCompletionProvider = {
  id: 'segment-ref',
  complete(ctx) {
    // 不限制 zone — @segment() 可能出现在任何位置
    const m = ctx.textBefore.match(/@segment\(([^)]*)$/);
    if (!m) return null;
    const prefix = m[1];
    const from = ctx.pos - prefix.length;
    // 检测光标右边是否已有 )，避免重复
    const textAfter = ctx.lineText.slice(ctx.colOffset);
    const hasCloseParen = textAfter.startsWith(')');

    if (ctx.data.segmentNames.length === 0) {
      return {
        from,
        options: [{
          label: '(暂无段落)',
          type: 'text' as const,
          detail: '请先在 TAB 编辑器中创建段落',
          apply: '',
        }],
        filter: false,
      };
    }

    const options: Completion[] = ctx.data.segmentNames.map(name => ({
      label: name,
      type: 'variable',
      detail: 'TAB 段落',
      apply: (view: EditorView, _c: Completion, f: number, t: number) => {
        const to = hasCloseParen ? t + 1 : t;
        view.dispatch({
          changes: { from: f, to, insert: name + ')' },
        });
      },
    }));
    return { from, options, filter: true };
  },
};

/** body 行首 @ — @segment() 或节奏型引用（独立行） */
const bodyAtSign: TmdCompletionProvider = {
  id: 'body-at-sign',
  complete(ctx) {
    if (ctx.zone !== 'body') return null;
    // 行首 @，但不在 ] 后面（那是 sectionRhythmRef 的场景）
    const m = ctx.textBefore.match(/^@(\w*)$/);
    if (!m) return null;
    const from = ctx.pos - m[0].length;
    const options: Completion[] = [
      {
        label: '@segment()',
        type: 'function',
        detail: '引用 TAB 段落',
        apply: applyWithCursor('@segment(', ')'),
      },
    ];
    return { from, options, filter: true };
  },
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建一个 apply 函数，插入文本后把光标放在 before 和 after 之间，
 * 然后自动触发下一轮补全（让括号内的候选立刻弹出）。
 *
 * 例: applyWithCursor('@segment(', ')') → 插入 @segment()，光标在 ( 和 ) 之间，自动弹出段落名候选
 */
function applyWithCursor(before: string, after: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const text = before + after;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + before.length },
    });
    // 延迟触发补全 — 需要等 CodeMirror 完成当前补全的关闭流程后再开新一轮
    setTimeout(() => startCompletion(view), 50);
  };
}

// ============================================================
// 导出 — 按优先级排列（具体的在前，通用的在后）
// ============================================================

/**
 * 所有 TMD 补全 provider
 *
 * 要添加新的补全规则：
 *   1. 在上面写一个新的 TmdCompletionProvider
 *   2. 加到这个数组里（注意顺序：更具体的放前面）
 *   3. 如果需要新的外部数据，在 CompletionData 接口里加字段
 */
export const providers: TmdCompletionProvider[] = [
  // Header
  headerRhythmDef,
  headerChordDef,
  headerMetaKey,
  // Body — 具体场景
  segmentRef,
  sectionRhythmRef,
  sectionName,
  inlineChordMark,
  measureRhythmRef,
  measureChord,
  bodyAtSign,
  // Body — 通用
  bodyLineStart,
];
