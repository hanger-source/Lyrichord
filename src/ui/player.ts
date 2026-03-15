/**
 * 播放控制器
 * 
 * 封装 AlphaTab 的播放功能：
 * - Play / Pause / Stop
 * - BPM 调节
 * - 播放状态管理
 */
import type * as alphaTab from '@coderline/alphatab';
import type { ScoreRenderer } from './renderer';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface PlayerOptions {
  renderer: ScoreRenderer;
  onStateChange?: (state: PlaybackState) => void;
}

export class PlaybackController {
  private renderer: ScoreRenderer;
  private state: PlaybackState = 'stopped';
  private onStateChange: ((state: PlaybackState) => void) | null;

  constructor(options: PlayerOptions) {
    this.renderer = options.renderer;
    this.onStateChange = options.onStateChange ?? null;
  }

  /** 播放或暂停 */
  playPause(): void {
    const api = this.renderer.getApi();
    if (!api) return;

    api.playPause();
    this.state = this.state === 'playing' ? 'paused' : 'playing';
    this.onStateChange?.(this.state);
  }

  /** 停止 */
  stop(): void {
    const api = this.renderer.getApi();
    if (!api) return;

    api.stop();
    this.state = 'stopped';
    this.onStateChange?.(this.state);
  }

  /** 设置播放速度（1.0 = 原速） */
  setPlaybackSpeed(speed: number): void {
    const api = this.renderer.getApi();
    if (!api) return;

    api.playbackSpeed = speed;
  }

  /** 获取当前状态 */
  getState(): PlaybackState {
    return this.state;
  }

  /** 销毁 */
  destroy(): void {
    this.stop();
  }
}
