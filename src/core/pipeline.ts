/**
 * TMD → AlphaTex 完整管线
 *
 * tmdToAlphaTex(text) → PipelineResult
 *
 * 数据流:
 *   TMD Text → scan() → Token[]
 *            → buildSong() → Song
 *            → validate() → ValidationResult
 *            → generate() → AlphaTexOutput
 */
import { scan } from './parser/scanner';
import { buildSong } from './parser/ast-builder';
import { validate } from './parser/validator';
import { generate } from './generator/alphatex';
import { setCustomChords, clearCustomChords } from './chord/resolver';
import type { AlphaTexOutput, Song } from './types';

/**
 * 段落引用解析器类型
 * 给定段落名，返回展开后的 TMD body（不含 header），或 null 表示找不到
 */
export type SegmentResolver = (name: string) => string | null;

/**
 * 展开 TMD 文本中的 @segment(Name) 引用
 *
 * 纯文本替换，在 pipeline 之前调用。
 * resolver 由调用方提供（从 DB 读段落 → genSectionBody）。
 * 展开后的文本可以直接传给 tmdToAlphaTex。
 */
export function expandSegmentRefs(source: string, resolver: SegmentResolver): string {
  return source.replace(/^\s*@segment\(([^)]+)\)\s*$/gm, (_match, name: string) => {
    const body = resolver(name.trim());
    if (body) return body;
    return `# [WARNING] 段落引用未找到: ${name.trim()}`;
  });
}

export interface PipelineResult {
  success: boolean;
  output: AlphaTexOutput | null;
  song: Song | null;
  errors: PipelineError[];
  warnings: PipelineWarning[];
}

export interface PipelineError {
  phase: 'scan' | 'build' | 'validate' | 'generate';
  message: string;
  line?: number;
}

export interface PipelineWarning {
  phase: 'scan' | 'build' | 'validate';
  message: string;
  line?: number;
}

export function tmdToAlphaTex(source: string): PipelineResult {
  const errors: PipelineError[] = [];
  const warnings: PipelineWarning[] = [];

  // Phase 1: 词法扫描
  const scanResult = scan(source);
  for (const err of scanResult.errors) {
    errors.push({ phase: 'scan', message: err.message, line: err.line });
  }

  // Phase 2: Song 构建
  const buildResult = buildSong(scanResult.tokens);
  for (const warn of buildResult.warnings) {
    warnings.push({ phase: 'build', message: warn.message, line: warn.line });
  }

  const song = buildResult.song;

  // 注册自定义和弦
  clearCustomChords();
  setCustomChords(song.chordLibrary);

  // Phase 3: 语义校验
  const validationResult = validate(song);
  for (const err of validationResult.errors) {
    errors.push({ phase: 'validate', message: err.message });
  }
  for (const warn of validationResult.warnings) {
    warnings.push({ phase: 'validate', message: warn.message });
  }

  // Phase 4: AlphaTex 生成
  let output: AlphaTexOutput | null = null;
  try {
    output = generate(song);
  } catch (e) {
    errors.push({
      phase: 'generate',
      message: `生成失败: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return { success: errors.length === 0, output, song, errors, warnings };
}
