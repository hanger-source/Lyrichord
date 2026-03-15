/**
 * TMD 词法扫描器 v2
 * 
 * 将 TabMarkdown 原始文本逐行扫描，产出 Token 流。
 * 
 * v2 新增：
 * - BAR_LINE: | 小节线
 * - CHORD_BEATS: *N 和弦占拍数
 * - REST: _ 空拍/延续
 * 
 * TMD 文本结构:
 *   ---
 *   title: 你瞒我瞒
 *   tempo: 72
 *   @R1: pluck(p-3-(12)-3)
 *   define [D/#F]: {frets: "2 0 0 2 3 2"}
 *   ---
 *   
 *   [A1] @R1
 *   | (C)约会像是为 (D)分享到饱肚滋 | (G)味 _ _ _ |
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

/**
 * 扫描 TMD 文本，产出 Token 流
 */
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

    // 空行 → NEWLINE
    if (trimmed === '') {
      tokens.push(tok('NEWLINE', '', lineNum, 0));
      continue;
    }

    // 头部分隔符 ---
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

    // 注释
    if (trimmed.startsWith('#') && !inHeader) {
      tokens.push(tok('COMMENT', trimmed.slice(1).trim(), lineNum, 0));
      continue;
    }

    // 头部内容
    if (inHeader) {
      scanHeaderLine(trimmed, lineNum, tokens, errors);
      continue;
    }

    // 正文内容
    scanBodyLine(trimmed, lineNum, tokens, errors);
  }

  return { tokens, errors };
}

// ============================================================
// 头部行扫描（不变）
// ============================================================

function scanHeaderLine(
  line: string,
  lineNum: number,
  tokens: Token[],
  errors: ScanError[]
): void {
  if (line.startsWith('#')) {
    tokens.push(tok('COMMENT', line.slice(1).trim(), lineNum, 0));
    return;
  }
  if (line.startsWith('@')) {
    tokens.push(tok('RHYTHM_DEF', line, lineNum, 0));
    return;
  }
  if (line.startsWith('define')) {
    tokens.push(tok('CHORD_DEF', line, lineNum, 0));
    return;
  }
  const colonIdx = line.indexOf(':');
  if (colonIdx > 0) {
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    tokens.push(tok('META_KEY', key, lineNum, 0));
    tokens.push(tok('META_VALUE', value, lineNum, colonIdx + 1));
    return;
  }
  errors.push({ message: `无法识别的头部行: "${line}"`, line: lineNum, col: 0 });
}

// ============================================================
// 正文行扫描 v2
// ============================================================

function scanBodyLine(
  line: string,
  lineNum: number,
  tokens: Token[],
  _errors: ScanError[]
): void {
  // 段落标记: [A1] @R1 或 [Chorus] @R2A
  const sectionMatch = line.match(/^\[([^\]]+)\]\s*(.*)/);
  if (sectionMatch) {
    tokens.push(tok('SECTION', sectionMatch[1], lineNum, 0));
    const rest = sectionMatch[2].trim();
    if (rest.startsWith('@')) {
      tokens.push(tok('RHYTHM_REF', rest, lineNum, sectionMatch[0].indexOf(rest)));
    }
    return;
  }

  // 包含 | 的行 → 小节驱动模式（v2）
  if (line.includes('|')) {
    scanMeasureLine(line, lineNum, tokens);
    return;
  }

  // 兼容旧格式：无小节线的歌词+和弦行
  scanLegacyLine(line, lineNum, tokens);
}

/**
 * v2: 扫描带小节线的行
 * 
 * 输入: "| (C)约会像是为 (D)分享到饱肚滋 | (G)味 _ _ _ |"
 * 输出: BAR_LINE, CHORD, LYRICS, CHORD, LYRICS, BAR_LINE, CHORD, LYRICS, REST, REST, REST, BAR_LINE
 */
function scanMeasureLine(
  line: string,
  lineNum: number,
  tokens: Token[]
): void {
  // 和弦正则：(ChordName) 可选跟 *N 表示占拍数
  // 和弦名可包含: 字母、数字、#、b、/
  const chordRegex = /\(([A-Ga-g][A-Za-z0-9#b/]*)\)(\*(\d+(?:\.\d+)?))?/g;

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    // 跳过空格
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // 小节线
    if (ch === '|') {
      tokens.push(tok('BAR_LINE', '|', lineNum, i));
      i++;
      continue;
    }

    // 空拍/延续标记
    if (ch === '_') {
      tokens.push(tok('REST', '_', lineNum, i));
      i++;
      continue;
    }

    // 和弦标记 (X) 或 (X)*N
    if (ch === '(') {
      chordRegex.lastIndex = i;
      const match = chordRegex.exec(line);
      if (match && match.index === i) {
        tokens.push(tok('CHORD', match[1], lineNum, i));
        if (match[3]) {
          tokens.push(tok('CHORD_BEATS', match[3], lineNum, i + match[0].length - match[3].length));
        }
        i = match.index + match[0].length;
        continue;
      }
    }

    // 歌词文本：收集到下一个特殊字符为止
    const lyricsStart = i;
    while (i < line.length && line[i] !== '|' && line[i] !== '(' && line[i] !== '_') {
      i++;
    }
    const lyrics = line.slice(lyricsStart, i).trim();
    if (lyrics) {
      tokens.push(tok('LYRICS', lyrics, lineNum, lyricsStart));
    }
  }

  tokens.push(tok('NEWLINE', '', lineNum, line.length));
}

/**
 * 兼容旧格式：无小节线的歌词+和弦行
 * 自动为每个和弦生成一个小节
 */
function scanLegacyLine(
  line: string,
  lineNum: number,
  tokens: Token[]
): void {
  const chordRegex = /\(([A-Ga-g][A-Za-z0-9#b/]*)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let hasChords = false;

  // 先加一个起始小节线
  tokens.push(tok('BAR_LINE', '|', lineNum, 0));

  while ((match = chordRegex.exec(line)) !== null) {
    hasChords = true;
    // 和弦前的歌词
    if (match.index > lastIndex) {
      const lyrics = line.slice(lastIndex, match.index);
      if (lyrics.trim()) {
        tokens.push(tok('LYRICS', lyrics, lineNum, lastIndex));
      }
    }
    // 每个和弦前加小节线（除了第一个）
    if (lastIndex > 0) {
      tokens.push(tok('BAR_LINE', '|', lineNum, match.index));
    }
    tokens.push(tok('CHORD', match[1], lineNum, match.index));
    lastIndex = match.index + match[0].length;
  }

  // 最后一段歌词
  if (lastIndex < line.length) {
    const remaining = line.slice(lastIndex);
    if (remaining.trim()) {
      tokens.push(tok('LYRICS', remaining, lineNum, lastIndex));
    }
  }

  // 结尾小节线
  if (hasChords) {
    tokens.push(tok('BAR_LINE', '|', lineNum, line.length));
  }

  tokens.push(tok('NEWLINE', '', lineNum, line.length));
}

// ============================================================
// 工具函数
// ============================================================

function tok(type: TokenType, value: string, line: number, col: number): Token {
  return { type, value, line, col };
}
