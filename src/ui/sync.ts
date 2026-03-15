/**
 * 编辑器 ↔ 曲谱同步管理
 * 
 * 职责：
 * - 编辑器内容变更 → 触发管线 → 更新渲染
 * - 错误/警告信息展示
 * - 后续：播放位置 → 高亮编辑器对应行
 */
import { tmdToAlphaTex, type PipelineResult } from '../core/pipeline';
import type { TmdEditor } from './editor';
import type { ScoreRenderer } from './renderer';

export interface SyncOptions {
  editor: TmdEditor;
  renderer: ScoreRenderer;
  onResult?: (result: PipelineResult) => void;
}

export class EditorScoreSync {
  private editor: TmdEditor;
  private renderer: ScoreRenderer;
  private onResult: ((result: PipelineResult) => void) | null;
  private lastTex: string = '';

  constructor(options: SyncOptions) {
    this.editor = options.editor;
    this.renderer = options.renderer;
    this.onResult = options.onResult ?? null;
  }

  /**
   * 执行一次同步：读取编辑器内容 → 管线转换 → 渲染
   */
  sync(): PipelineResult {
    const source = this.editor.getContent();
    const result = tmdToAlphaTex(source);

    // 通知外部
    this.onResult?.(result);

    // 只在 tex 实际变化时才重新渲染（避免闪烁）
    if (result.output && result.output.tex !== this.lastTex) {
      this.lastTex = result.output.tex;
      this.renderer.renderTex(result.output.tex);
    }

    return result;
  }

  /** 获取上次生成的 AlphaTex */
  getLastTex(): string {
    return this.lastTex;
  }
}
