/**
 * AlphaTab 渲染器封装
 * 
 * 职责：
 * - 初始化 AlphaTab API
 * - 接收 AlphaTex 字符串并渲染
 * - 管理 SoundFont 加载
 * - 处理容器 resize
 */
import * as alphaTab from '@coderline/alphatab';

export interface RendererOptions {
  /** 渲染容器 DOM 元素 */
  container: HTMLElement;
  /** SoundFont 文件路径（可选，启用播放需要） */
  soundFontUrl?: string;
}

export class ScoreRenderer {
  private api: alphaTab.AlphaTabApi | null = null;
  private container: HTMLElement;
  private soundFontUrl: string | undefined;
  private isReady = false;

  constructor(options: RendererOptions) {
    this.container = options.container;
    this.soundFontUrl = options.soundFontUrl;
  }

  /** 初始化 AlphaTab */
  async init(): Promise<void> {
    const settings: alphaTab.Settings = new alphaTab.Settings();

    // 渲染设置
    settings.core.fontDirectory = '/font/bravura/';
    settings.core.engine = 'svg';
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    // Vite 打包后 AlphaTab 无法自动检测 scriptFile，先关闭 worker 同步渲染
    settings.core.useWorkers = false;

    // 显示设置
    settings.display.staveProfile = alphaTab.StaveProfile.Tab;
    settings.display.layoutMode = alphaTab.LayoutMode.Page;

    // 播放器设置
    if (this.soundFontUrl) {
      settings.player.enablePlayer = true;
      settings.player.enableCursor = true;
      settings.player.enableUserInteraction = true;
      settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
      settings.player.soundFont = this.soundFontUrl;
    }

    this.api = new alphaTab.AlphaTabApi(this.container, settings);

    // 等待渲染就绪
    return new Promise<void>((resolve) => {
      this.api!.renderFinished.on(() => {
        this.isReady = true;
        resolve();
      });
    });
  }

  /** 用 AlphaTex 字符串更新曲谱 */
  renderTex(tex: string): void {
    if (!this.api) {
      console.warn('AlphaTab 未初始化');
      return;
    }
    try {
      this.api.tex(tex);
    } catch (e) {
      console.error('AlphaTex 渲染失败:', e);
    }
  }

  /** 获取 AlphaTab API（供 player 使用） */
  getApi(): alphaTab.AlphaTabApi | null {
    return this.api;
  }

  /** 是否已就绪 */
  ready(): boolean {
    return this.isReady;
  }

  /** 销毁 */
  destroy(): void {
    if (this.api) {
      this.api.destroy();
      this.api = null;
    }
    this.isReady = false;
  }
}
