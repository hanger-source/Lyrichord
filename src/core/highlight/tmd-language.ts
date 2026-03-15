/**
 * TMD 语法高亮 — CodeMirror 6 StreamLanguage
 *
 * 基于逐行 tokenizer，识别 TMD 的各种行类型并标记 token。
 * 颜色映射在 tmd-theme.ts 中定义。
 *
 * Token 名字规则（StreamLanguage → @lezer/highlight tag 映射）：
 *   - 直接用 tags 里的 base tag 名：'keyword', 'string', 'number', 'comment',
 *     'heading', 'typeName', 'variableName', 'labelName', 'operator', 'bracket',
 *     'punctuation', 'processingInstruction'
 *   - 复合 tag 用 "." 连接：'variableName.definition' → tags.definition(tags.variableName)
 *   - modifier + base：'variableName.standard' → tags.standard(tags.variableName)
 *
 * 扩展方式：
 *   - 新增行类型 → 在 tokenBody / tokenHeader 里加分支
 *   - 新增 token 类型 → 在 tmd-theme.ts 里加颜色映射
 */
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { tags, Tag } from '@lezer/highlight';

interface TmdState {
  /** 当前所在区域 */
  zone: 'before-header' | 'header' | 'body';
  /** 当前行类型（body 区域） */
  lineType: 'unknown' | 'section' | 'measure' | 'lyrics' | 'tex' | 'comment' | 'segment-ref';
  /** 行是否刚开始 */
  lineStart: boolean;
}

/**
 * 自定义 token 名 → Tag 映射
 *
 * StreamLanguage 的 tokenTable 参数：
 * 当 tokenizer 返回的名字不在 @lezer/highlight 的默认 tags 里时，
 * 通过这个表映射到自定义 Tag。
 *
 * 这里我们定义几个 TMD 专用的 token 类型，
 * 用于区分"节奏型定义"和"普通函数"等场景。
 */
const tmdRhythmDef = Tag.define();    // @R1: pluck(...) 节奏型定义名
const tmdSegmentRef = Tag.define();   // @segment(Name) 引用
const tmdAtRef = Tag.define();        // @R1 节奏型引用

const tokenTable: Record<string, Tag> = {
  rhythmDef: tmdRhythmDef,
  segmentRef: tmdSegmentRef,
  atRef: tmdAtRef,
};

/** 导出自定义 Tag，供 tmd-theme.ts 使用 */
export { tmdRhythmDef, tmdSegmentRef, tmdAtRef };

const tmdParser: StreamParser<TmdState> = {
  startState(): TmdState {
    return { zone: 'before-header', lineType: 'unknown', lineStart: true };
  },

  tokenTable,

  token(stream, state): string | null {
    // 行首重置
    if (stream.sol()) {
      state.lineStart = true;
      state.lineType = 'unknown';
    }

    // --- 分隔符
    if (state.lineStart && stream.match(/^---\s*$/)) {
      state.lineStart = false;
      if (state.zone === 'before-header') {
        state.zone = 'header';
      } else if (state.zone === 'header') {
        state.zone = 'body';
      }
      return 'processingInstruction';
    }

    state.lineStart = false;

    if (state.zone === 'header') {
      return tokenHeader(stream, state);
    }

    return tokenBody(stream, state);
  },
};

/** Header 区域 tokenizer */
function tokenHeader(stream: any, _state: TmdState): string | null {
  // 节奏型定义: @R1: pluck(...)
  if (stream.sol() && stream.match(/^@\w+/)) {
    return 'rhythmDef';
  }
  // define 关键字
  if (stream.sol() && stream.match(/^define\b/)) {
    return 'keyword';
  }
  // 和弦名 [X]
  if (stream.match(/^\[[^\]]*\]/)) {
    return 'typeName';
  }
  // meta key (行首单词后跟冒号)
  if (stream.sol() && stream.match(/^\w[\w_]*(?=\s*:)/)) {
    return 'keyword';
  }
  // 冒号
  if (stream.match(/^:\s*/)) {
    return 'punctuation';
  }
  // 字符串值（引号内）
  if (stream.match(/^"[^"]*"/)) {
    return 'string';
  }
  if (stream.match(/^'[^']*'/)) {
    return 'string';
  }
  // 数字
  if (stream.match(/^\d+\/\d+/)) {
    return 'number';
  }
  if (stream.match(/^\d+/)) {
    return 'number';
  }
  // pluck/strum 函数名
  if (stream.match(/^(?:pluck|strum)\b/)) {
    return 'keyword';
  }
  // 括号内的 pattern 内容
  if (stream.match(/^\([^)]*\)/)) {
    return 'string';
  }
  // frets / speed 等关键字
  if (stream.match(/^(?:frets|speed)\b/)) {
    return 'keyword';
  }
  // 花括号
  if (stream.match(/^[{}]/)) {
    return 'bracket';
  }

  stream.next();
  return null;
}

/** Body 区域 tokenizer */
function tokenBody(stream: any, state: TmdState): string | null {
  // 注释行
  if (stream.sol() && stream.match(/^#.*/)) {
    state.lineType = 'comment';
    return 'comment';
  }

  // 段落标记: [SectionName]
  if (stream.sol() && stream.peek() === '[') {
    const m = stream.match(/^\[[^\]]+\]/);
    if (m) {
      state.lineType = 'section';
      return 'heading';
    }
  }

  // 段落行后面的节奏型引用 @R1
  if (state.lineType === 'section' && stream.match(/^\s*@\w+/)) {
    return 'atRef';
  }

  // @segment(Name) 引用 — 整行
  if (stream.sol() && stream.match(/^@segment\([^)]*\)/)) {
    state.lineType = 'segment-ref';
    return 'segmentRef';
  }

  // 通用 @ 引用（@R1, @R2A 等，或 @segment(...)）
  if (stream.match(/^@\w+(?:\([^)]*\))?/)) {
    return 'atRef';
  }

  // 小节行: | ... |
  if (stream.sol() && stream.peek() === '|') {
    state.lineType = 'measure';
  }

  if (state.lineType === 'measure') {
    return tokenMeasureLine(stream);
  }

  // w: / w2: 歌词行
  if (stream.sol() && stream.match(/^w2?:/)) {
    state.lineType = 'lyrics';
    return 'labelName';
  }

  if (state.lineType === 'lyrics') {
    return tokenLyricsLine(stream);
  }

  // tex: 行
  if (stream.sol() && stream.match(/^tex:/)) {
    state.lineType = 'tex';
    return 'labelName';
  }

  if (state.lineType === 'tex') {
    return tokenTexLine(stream);
  }

  // 其他 — 跳过
  stream.next();
  return null;
}

/** 小节行 tokenizer: | C . D . | */
function tokenMeasureLine(stream: any): string | null {
  if (stream.eatSpace()) return null;

  if (stream.eat('|')) {
    return 'bracket';
  }

  if (stream.match(/^\.\s/) || stream.match(/^\.$/)) {
    return 'operator';
  }

  // 和弦名
  if (stream.match(/^[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add[249]?|7|9|11|13|6)?(?:\/[A-G#b]+)?/)) {
    return 'typeName';
  }

  stream.next();
  return null;
}

/** 歌词行 tokenizer */
function tokenLyricsLine(stream: any): string | null {
  if (stream.eatSpace()) return null;

  if (stream.match(/^\[[^\]]+\]/)) {
    return 'typeName';
  }

  if (stream.eat('~')) {
    return 'operator';
  }

  if (stream.match(/^[^\[~]+/)) {
    return 'string';
  }

  stream.next();
  return null;
}

/** TEX 行 tokenizer */
function tokenTexLine(stream: any): string | null {
  if (stream.eatSpace()) return null;

  if (stream.match(/^\[[^\]]+\]/)) {
    return 'typeName';
  }

  if (stream.match(/^\([^)]+\)\.\d+(?:\{[^}]*\})?/)) {
    return 'number';
  }

  if (stream.match(/^r\.\d+(?:\{[^}]*\})?/)) {
    return 'operator';
  }

  if (stream.match(/^\d+\.\d+\.\d+(?:\{[^}]*\})?/)) {
    return 'number';
  }

  stream.next();
  return null;
}

/** 导出 CodeMirror Language 实例 */
export const tmdLanguage = StreamLanguage.define(tmdParser);
