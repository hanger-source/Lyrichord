/**
 * 曲谱渲染 + 播放控制面板
 *
 * AlphaTab 自己管理 DOM，React 通过 ref 挂载容器。
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { initChordTooltip, destroyChordTooltip } from '../chord-tooltip';
import type { PipelineResult } from '../../core/pipeline';
import type { PlaybackState } from '../hooks/useAppState';

interface ScorePaneProps {
  pipelineResult: PipelineResult | null;
  playbackState: PlaybackState;
  onPlaybackStateChange: (state: PlaybackState) => void;
}

export function ScorePane({ pipelineResult, playbackState, onPlaybackStateChange }: ScorePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const lastTexRef = useRef('');
  const [bpm, setBpm] = useState(72);
  const [isRendering, setIsRendering] = useState(false);

  // 初始化 AlphaTab
  useEffect(() => {
    if (!containerRef.current) return;

    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = '/font/bravura/';
    settings.core.engine = 'svg';
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.core.useWorkers = false;
    settings.display.staveProfile = alphaTab.StaveProfile.Tab;
    settings.display.layoutMode = alphaTab.LayoutMode.Page;
    settings.player.enablePlayer = true;
    settings.player.enableCursor = true;
    settings.player.enableUserInteraction = true;
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
    settings.player.soundFont = '/soundfont/sonivox.sf2';

    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;

    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));

    // 播放状态同步
    api.playerStateChanged.on(e => {
      if (e.state === alphaTab.synth.PlayerState.Playing) {
        onPlaybackStateChange('playing');
      } else {
        onPlaybackStateChange(e.stopped ? 'stopped' : 'paused');
      }
    });

    initChordTooltip(containerRef.current);

    return () => {
      destroyChordTooltip();
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  // 管线结果变化 → 更新渲染
  useEffect(() => {
    if (!apiRef.current || !pipelineResult?.output) return;
    const tex = pipelineResult.output.tex;
    if (tex === lastTexRef.current) return;
    lastTexRef.current = tex;
    try {
      apiRef.current.tex(tex);
    } catch (e) {
      console.error('AlphaTex 渲染失败:', e);
    }
  }, [pipelineResult]);

  // BPM 同步
  useEffect(() => {
    if (pipelineResult?.song?.meta.tempo) {
      setBpm(pipelineResult.song.meta.tempo);
    }
  }, [pipelineResult?.song?.meta.tempo]);

  const handlePlayPause = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.playPause();
  }, []);

  const handleStop = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.stop();
    onPlaybackStateChange('stopped');
  }, [onPlaybackStateChange]);

  const handleBpmChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (val > 0 && val <= 300) {
      setBpm(val);
      if (apiRef.current) {
        const baseTempo = pipelineResult?.song?.meta.tempo ?? 72;
        apiRef.current.playbackSpeed = val / baseTempo;
      }
    }
  }, [pipelineResult?.song?.meta.tempo]);

  const measureCount = pipelineResult?.song?.masterBars.length ?? 0;

  return (
    <div className="score-pane">
      <div className="pane-toolbar">
        <span className="pane-title">
          🎼 曲谱预览
          {measureCount > 0 && <span className="measure-count">{measureCount} 小节</span>}
          {isRendering && <span className="rendering-indicator">渲染中...</span>}
        </span>
        <div className="player-controls">
          <button
            className={`btn-player ${playbackState === 'playing' ? 'btn-player--active' : ''}`}
            onClick={handlePlayPause}
            title={playbackState === 'playing' ? '暂停' : '播放'}
          >
            {playbackState === 'playing' ? '⏸' : '▶'}
          </button>
          <button className="btn-player" onClick={handleStop} title="停止">⏹</button>
          <label className="bpm-control">
            <span className="bpm-label">BPM</span>
            <input
              type="number"
              value={bpm}
              onChange={handleBpmChange}
              min={40}
              max={300}
            />
          </label>
        </div>
      </div>
      <div ref={containerRef} className="alphatab-container" />
    </div>
  );
}
