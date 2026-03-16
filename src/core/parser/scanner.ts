/**
 * TMD 词法扫描器 v4
 *
 * v4 格式:
 *   Header:  --- ... ---  (YAML-like meta + rhythm/chord defs)
 *   小节行:  | C . D . |
 *   歌词行:  w: [C]约会像是为分[D]享到饱肚
 *   歌词2:   w2: [C]第二段歌词
 *   TEX行:   tex: [C]3.5.8 0.3.8 [D]0.4.8 2.3.8
 *   段落:    [Intro]  或  [A1] @R1
 *   注释:    # ...
 *
 * 小节行语法:
 *   |       → BAR_LINE
 *   和弦名  → CHORD_BEAT (占1拍)
 *   .       → NOTE_EVENT "." (延续拍)
 *
 * 歌词行语法:
 *   [X] → CHORD_MARK
 *   文字 → LYRICS
 *   ~   → LYRICS "~" (延音)
 *
 * TEX行语法:
 *   [X]           → CHORD_MARK
 *   3.5.8 等beat  → NOTE_EVENT (原始 AlphaTex beat 文本)
 *   (f.s f.s).dur → NOTE_EVENT (多音 beat)
 *   r.dur         → NOTE_EVENT (休止)
 */
import type { Token, TokenType } from '../types';

export interface ScanResult {
  tokens: Token[];
  errors: ScanError[];
}

export interface ScanError {
  message: string;
  line: number;
  col: number;
}

function tok(type: TokenType, value: string, line: number, col: number): Token {
  return { type, value, line, col };
}

export function scan(source: string): ScanResult {
  const lines = source.split('\n');
  const tokens: Token[] = [];
  const errors: ScanError[] = [];

  let inHeader = false;
  let headerDelimiterCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;
    const trimmed = line.trim();

    if (trimmed === '') {
      tokens.push(tok('NEWLINE', '', lineNum, 0));
      continue;
    }

    if (trimmed === '---') {
      headerDelimiterCount++;
      if (headerDelimiterCount === 1) {
        inHeader = true;
        tokens.push(tok('HEADER_START', '---', lineNum, 0));
      } else {
        inHeader = false;
        tokens.push(tok('HEADER_END', '---', lineNum, 0));
      }
      continue;
    }

    if (trimmed.startsWith('#') && !inHeader) {
      tokens.push(tok('COMMENT', trimmed.slice(1).trim(), lineNum, 0));
      continue;
    }

    if (inHeader) {
      scanHeaderLine(trimmed, lineNum, tokens, errors);
      continue;
    }

    scanBodyLine(trimmed, lineNum, tokens, errors);
  }

  return { tokens, errors };
}

// ============================================================
// Header 行扫描
// ============================================================

/**
 * 扫描 header 内的一行
 *
 * 支持:
 *   key: value          → META_KEY + META_VALUE
 *   @R1: pluck(...)     → RHYTHM_DEF
 *   define [X]: {...}   → CHORD_DEF
 */
function scanHeaderLine(
  line: string, lineNum: number,
  tokens: Token[], errors: ScanError[],
): void {
  // 节奏型定义: @R1: ...
  if (line.startsWith('@')) {
    tokens.push(tok('RHYTHM_DEF', line, lineNum, 0));
    return;
  }

  // 和弦定义: define [X]: ...
  if (line.startsWith('define ')) {
    tokens.push(tok('CHORD_DEF', line, lineNum, 0));
    return;
  }

  // 普通 meta: key: value
  const colonIdx = line.indexOf(':');
  if (colonIdx > 0) {
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    tokens.push(tok('META_KEY', key, lineNum, 0));
    tokens.push(tok('META_VALUE', value, lineNum, colonIdx + 1));
    return;
  }

  errors.push({ message: `无法解析 header 行: "${line}"`, line: lineNum, col: 0 });
}

// ============================================================
// Body 行扫描 (header 之后的所有内容)
// ============================================================

/**
 * 分发 body 行到具体的扫描函数
 *
 * 行类型判断:
 *   [SectionName]  → 段落标记 (可能带 @R1 节奏引用)
 *   | ...          → 小节行
 *   w: ...         → 歌词行
 *   w2: ...        → 第二段歌词行
 *   tex: ...       → TEX 行 (精确 AlphaTex beat)
 *   # ...          → 注释 (已在 scan() 中处理)
 */
function scanBodyLine(
  line: string, lineNum: number,
  tokens: Token[], errors: ScanError[],
): void {
  // 段落标记: [Intro]  或  [A1] @R1
  if (line.startsWith('[')) {
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*(.*)/);
    if (sectionMatch) {
      tokens.push(tok('SECTION', sectionMatch[1], lineNum, 0));
      const rest = sectionMatch[2].trim();
      if (rest.startsWith('@')) {
        tokens.push(tok('RHYTHM_REF', rest, lineNum, sectionMatch[1].length + 3));
      }
      return;
    }
  }

  // TAB 段落引用: @segment(Name)
  const segRefMatch = line.match(/^@segment\(([^)]+)\)$/);
  if (segRefMatch) {
    tokens.push(tok('SEGMENT_REF', segRefMatch[1].trim(), lineNum, 0));
    return;
  }

  // 小节行: | C . D . |
  if (line.startsWith('|')) {
    scanMeasureLine(line, lineNum, tokens, errors);
    return;
  }

  // 歌词行: w: ...
  if (line.startsWith('w:')) {
    scanLyricsLine(line.slice(2), lineNum, 2, tokens, errors);
    return;
  }

  // 第二段歌词: w2: ...
  if (line.startsWith('w2:')) {
    tokens.push(tok('W2_START', 'w2', lineNum, 0));
    scanLyricsLine(line.slice(3), lineNum, 3, tokens, errors);
    return;
  }

  // TEX 行: tex: ...
  if (line.startsWith('tex:')) {
    scanTexLine(line.slice(4), lineNum, 4, tokens, errors);
    return;
  }

  errors.push({ message: `无法识别的行: "${line}"`, line: lineNum, col: 0 });
}

// ============================================================
// 小节行扫描: | C . D . |
// ============================================================

/**
 * 扫描小节行
 *
 * 语法: | token token ... |
 *   |       → BAR_LINE
 *   和弦名  → CHORD_BEAT (如 C, Am, D/#F, B7, Em, Gm)
 *   .       → NOTE_EVENT "." (延续拍，前一个和弦继续)
 */
function scanMeasureLine(
  line: string, lineNum: number,
  tokens: Token[], errors: ScanError[],
): void {
  // 按空白分割，逐个处理
  const parts = line.split(/\s+/).filter(p => p.length > 0);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const col = line.indexOf(part, i > 0 ? line.indexOf(parts[i - 1]) + parts[i - 1].length : 0);

    if (part === '|') {
      tokens.push(tok('BAR_LINE', '|', lineNum, col));
    } else if (part === '.') {
      tokens.push(tok('NOTE_EVENT', '.', lineNum, col));
    } else {
      // 和弦名: C, Am, D/#F, B7, Em7, Gm, Eb 等
      tokens.push(tok('CHORD_BEAT', part, lineNum, col));
    }
  }
}

// ============================================================
// 歌词行扫描: w: [C]约会像是为分[D]享到饱肚
// ============================================================

/**
 * 扫描歌词行内容 (w: 或 w2: 后面的部分)
 *
 * 语法:
 *   [X]  → CHORD_MARK (和弦入点标记)
 *   文字  → LYRICS (歌词文本片段)
 *   ~    → LYRICS "~" (延音/无歌词)
 *
 * 每个 [X] 标记后面跟着的文字属于该和弦
 */
function scanLyricsLine(
  content: string, lineNum: number, baseCol: number,
  tokens: Token[], errors: ScanError[],
): void {
  const text = content.trimStart();
  const trimOffset = content.length - text.length;
  let pos = 0;

  while (pos < text.length) {
    // 和弦标记: [X]
    if (text[pos] === '[') {
      const closeIdx = text.indexOf(']', pos + 1);
      if (closeIdx === -1) {
        errors.push({ message: `歌词行缺少 ] 闭合`, line: lineNum, col: baseCol + trimOffset + pos });
        break;
      }
      const chordName = text.slice(pos + 1, closeIdx);
      tokens.push(tok('CHORD_MARK', chordName, lineNum, baseCol + trimOffset + pos));
      pos = closeIdx + 1;
      continue;
    }

    // 收集文字直到下一个 [ 或行尾
    let end = pos;
    while (end < text.length && text[end] !== '[') {
      end++;
    }
    const lyrics = text.slice(pos, end);
    if (lyrics.length > 0) {
      tokens.push(tok('LYRICS', lyrics, lineNum, baseCol + trimOffset + pos));
    }
    pos = end;
  }
}


// ============================================================
// TEX 行扫描: tex: [C]3.5.8 0.3.8 [D]0.4.8 2.3.8
// ============================================================

/**
 * 扫描 TEX 行内容 (tex: 后面的部分)
 *
 * 语法:
 *   [X]              → CHORD_MARK (和弦入点)
 *   fret.string.dur  → NOTE_EVENT (单音 beat)
 *   (f.s f.s).dur    → NOTE_EVENT (多音 beat，保留括号)
 *   r.dur            → NOTE_EVENT (休止)
 *
 * 先发射 TEX_START 标记，然后逐个解析 token
 */
function scanTexLine(
  content: string, lineNum: number, baseCol: number,
  tokens: Token[], errors: ScanError[],
): void {
  tokens.push(tok('TEX_START', 'tex', lineNum, 0));

  const text = content.trim();
  let pos = 0;

  while (pos < text.length) {
    // 跳过空白
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length) break;

    // 和弦标记: [X]
    if (text[pos] === '[') {
      const closeIdx = text.indexOf(']', pos + 1);
      if (closeIdx === -1) {
        errors.push({ message: `tex 行缺少 ] 闭合`, line: lineNum, col: baseCol + pos });
        break;
      }
      const chordName = text.slice(pos + 1, closeIdx);
      tokens.push(tok('CHORD_MARK', chordName, lineNum, baseCol + pos));
      pos = closeIdx + 1;
      continue;
    }

    // 多音 beat: (f.s f.s).dur {props}
    if (text[pos] === '(') {
      const closeIdx = text.indexOf(')', pos + 1);
      if (closeIdx === -1) {
        errors.push({ message: `tex 行缺少 ) 闭合`, line: lineNum, col: baseCol + pos });
        break;
      }
      // 找到 ) 后面的 .dur 部分
      let end = closeIdx + 1;
      // 跳过 .dur 部分
      while (end < text.length && !(/\s/.test(text[end])) && text[end] !== '[') {
        end++;
      }
      // 检查后面是否紧跟 {props} 属性块
      let propEnd = end;
      while (propEnd < text.length && /\s/.test(text[propEnd])) propEnd++;
      if (propEnd < text.length && text[propEnd] === '{') {
        const braceClose = text.indexOf('}', propEnd + 1);
        if (braceClose !== -1) {
          end = braceClose + 1;
        }
      }
      const beatText = text.slice(pos, end);
      tokens.push(tok('NOTE_EVENT', beatText, lineNum, baseCol + pos));
      pos = end;
      continue;
    }

    // 单音 beat 或 rest: fret.string.dur 或 r.dur，可能带 {props}
    let end = pos;
    while (end < text.length && !/\s/.test(text[end]) && text[end] !== '[') {
      end++;
    }
    // 检查后面是否紧跟 {props} 属性块
    let propEnd = end;
    while (propEnd < text.length && /\s/.test(text[propEnd])) propEnd++;
    if (propEnd < text.length && text[propEnd] === '{') {
      const braceClose = text.indexOf('}', propEnd + 1);
      if (braceClose !== -1) {
        end = braceClose + 1;
      }
    }
    const beatText = text.slice(pos, end);
    if (beatText.length > 0) {
      tokens.push(tok('NOTE_EVENT', beatText, lineNum, baseCol + pos));
    }
    pos = end;
  }
}
