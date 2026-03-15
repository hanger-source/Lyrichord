/**
 * 曲谱渲染 + 播放控制面板
 *
 * AlphaTab 自己管理 DOM，React 通过 ref 挂载容器。
 */
import { useRef, useEffect, useCallback, useState, memo } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { Play, Pause, Square, RotateCcw, Loader } from 'lucide-react';
import { initChordTooltip, destroyChordTooltip } from '../chord-tooltip';
import type { PipelineResult } from '../../core/pipeline';
import type { PlaybackState } from '../hooks/useAppState';
import type { ColorTokens } from '../theme';

interface ScorePaneProps {
  pipelineResult: PipelineResult | null;
  playbackState: PlaybackState;
  onPlaybackStateChange: (state: PlaybackState) => void;
  colors: ColorTokens;
  /** 父组件告知当前是否可见，从 false→true 时触发重新渲染 */
  visible?: boolean;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export const ScorePane = memo(function ScorePane({ pipelineResult, playbackState, onPlaybackStateChange, colors, visible = true }: ScorePaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const lastTexRef = useRef('');
  const [bpm, setBpm] = useState(72);
  const [isRendering, setIsRendering] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  // 播放中标记 — 用 ref 避免闭包过期，IntersectionObserver 回调里能拿到最新值
  const isPlayingRef = useRef(false);
  // 播放进度用 ref 缓冲 + rAF 节流，避免高频 setState 阻塞主线程
  const pendingTimeRef = useRef<{ current: number; end: number } | null>(null);
  const rafIdRef = useRef(0);

  // 初始化 AlphaTab
  useEffect(() => {
    if (!containerRef.current) return;

    // 按照 alphaTab 官方 vite-react 示例的方式初始化
    // 使用 SettingsJson 对象而非 new Settings() 实例
    const settings: alphaTab.json.SettingsJson = {
      core: {
        fontDirectory: '/font/',
        engine: 'svg',
        logLevel: 'warning',
        useWorkers: true,
      },
      display: {
        staveProfile: 'tab',
        layoutMode: 'page',
        scale: 1.0,
        padding: [60, 40],
        firstSystemPaddingTop: 40,
        systemPaddingTop: 15,
        notationStaffPaddingTop: 8,
        effectBandPaddingBottom: 6,
      },
      notation: {
        rhythmMode: 'ShowWithBars',
        rhythmHeight: 20,
        elements: {
          effectLyrics: true,
          effectChordNames: true,
          effectMarker: true,
          effectTempo: true,
          effectCapo: false,
          effectDynamics: false,
        } as any,
      },
      player: {
        enablePlayer: true,
        enableCursor: true,
        enableUserInteraction: true,
        scrollMode: 'continuous',
        soundFont: '/soundfont/sonivox.sf2',
      },
    };
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;

    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));

    api.playerReady.on(() => {
      console.log('AlphaTab player ready');
      setPlayerReady(true);
    });

    api.error.on((e: { message?: string; type?: string }) => {
      console.error('AlphaTab error:', e);
    });

    api.playerStateChanged.on(e => {
      if (e.state === alphaTab.synth.PlayerState.Playing) {
        isPlayingRef.current = true;
        onPlaybackStateChange('playing');
      } else {
        isPlayingRef.current = false;
        onPlaybackStateChange('paused');
      }
    });

    api.playerFinished.on(() => {
      isPlayingRef.current = false;
      onPlaybackStateChange('stopped');
      setCurrentTime(0);
    });

    // 播放进度 — 用 rAF 节流，避免高频 setState
    api.playerPositionChanged.on(e => {
      pendingTimeRef.current = { current: e.currentTime, end: e.endTime };
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = 0;
          if (pendingTimeRef.current) {
            setCurrentTime(pendingTimeRef.current.current);
            setTotalTime(pendingTimeRef.current.end);
            pendingTimeRef.current = null;
          }
        });
      }
    });

    initChordTooltip(containerRef.current);

    // 容器重新可见时触发重新渲染（解决 display:none 后恢复白屏）
    // 播放中跳过，避免 re-render 阻塞主线程导致音频卡顿
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && apiRef.current && !isPlayingRef.current) {
          apiRef.current.render();
        }
      }
    }, { threshold: 0.01 });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
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

  // visible 从 false→true 时重新渲染（解决 display:none 后恢复白屏）
  // 播放中跳过
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const wasHidden = !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (wasHidden && visible && apiRef.current && !isPlayingRef.current) {
      requestAnimationFrame(() => {
        if (apiRef.current && !isPlayingRef.current) {
          apiRef.current.render();
        }
      });
    }
  }, [visible]);

  // BPM 同步
  useEffect(() => {
    if (pipelineResult?.song?.meta.tempo) {
      setBpm(pipelineResult.song.meta.tempo);
    }
  }, [pipelineResult?.song?.meta.tempo]);

  // 主题配色同步到 alphaTab
  const colorsApplied = useRef(false);
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    // 跳过首次（初始化时已经是默认色）
    if (!colorsApplied.current) {
      colorsApplied.current = true;
      return;
    }
    const res = api.settings.display.resources;
    const c = alphaTab.model.Color.fromJson;
    const mainColor = c(colors.textPrimary);
    const staffColor = c(colors.border);
    const barColor = c(colors.textPrimary);
    const infoColor = c(colors.textSecondary);
    if (mainColor) res.mainGlyphColor = mainColor;
    if (staffColor) res.staffLineColor = staffColor;
    if (barColor) res.barSeparatorColor = barColor;
    if (infoColor) res.scoreInfoColor = infoColor;
    api.updateSettings();
    api.render();
  }, [colors]);

  const handlePlayPause = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.playPause();
  }, []);

  const handleStop = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.stop();
    onPlaybackStateChange('stopped');
    setCurrentTime(0);
  }, [onPlaybackStateChange]);

  const handleRestart = useCallback(() => {
    if (!apiRef.current) return;
    apiRef.current.stop();
    setCurrentTime(0);
    // 短延迟后从头播放
    setTimeout(() => {
      if (apiRef.current) apiRef.current.play();
    }, 50);
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!apiRef.current || totalTime <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // AlphaTab 用 tickPosition 来 seek
    apiRef.current.tickPosition = Math.round(ratio * (apiRef.current.score?.masterBars?.length ?? 1) * 960 * 4);
  }, [totalTime, currentTime]);

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
  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  return (
    <div className="score-pane">
      <div className="pane-toolbar">
        <span className="pane-title">
          曲谱预览
          {measureCount > 0 && <span className="measure-count">{measureCount} 小节</span>}
          {isRendering && <span className="rendering-indicator">渲染中...</span>}
        </span>
        <div className="player-controls">
          <button className="btn-player" onClick={handleRestart} disabled={!playerReady} title="从头播放">
            <RotateCcw size={13} />
          </button>
          <button
            className={`btn-player ${playbackState === 'playing' ? 'btn-player--active' : ''}`}
            onClick={handlePlayPause}
            disabled={!playerReady}
            title={!playerReady ? '音源加载中...' : playbackState === 'playing' ? '暂停' : '播放'}
          >
            {!playerReady ? <Loader size={14} className="spin" /> : playbackState === 'playing' ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button className="btn-player" onClick={handleStop} disabled={!playerReady} title="停止">
            <Square size={12} />
          </button>
          <span className="player-time">
            {formatTime(currentTime)} / {formatTime(totalTime)}
          </span>
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
      {/* 进度条 */}
      <div className="player-progress" onClick={handleProgressClick} title="点击跳转">
        <div className="player-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div ref={containerRef} className="alphatab-container" />
    </div>
  );
});
