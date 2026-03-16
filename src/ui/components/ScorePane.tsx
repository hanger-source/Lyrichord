/**
 * 曲谱渲染 + 播放控制面板 (ScorePane)
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  职责                                                        │
 * │  1. 初始化 AlphaTab API，挂载到 DOM 容器                      │
 * │  2. 接收 PipelineResult → 调用 api.tex() 渲染曲谱             │
 * │  3. 播放控制 (play/pause/stop/restart/seek/BPM)              │
 * │  4. 主题配色同步到 AlphaTab 渲染资源                          │
 * │  5. 修复 AlphaTab 的 Marker/Chord 文字重叠 bug               │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 数据流:
 *   useAppState → pipelineResult → ScorePane
 *     → api.tex(alphaTex)  → AlphaTab 渲染 SVG
 *     → api.scoreLoaded    → 注入 let ring 延音
 *     → api.postRenderFinished → fixMarkerOverlap hack
 *
 * AlphaTab 配置要点:
 *   - staveProfile: 'tab'     → 只显示 TAB 谱，不显示五线谱
 *   - soundFont: MuseScore_General.sf3 (38MB, 高质量 GM 吉他采样)
 *   - let ring 通过 scoreLoaded 回调注入 note.isLetRing = true
 *     (不通过 AlphaTex {lr} 语法，避免文本膨胀)
 *   - effectLetRing/effectPalmMute 设为 false，隐藏谱面虚线标记
 *
 * React 集成注意:
 *   - AlphaTab 自己管理 DOM，React 只提供容器 div (ref)
 *   - useEffect 空依赖 [] 初始化一次，return 里 destroy
 *   - 播放进度用 ref + rAF 节流，避免高频 setState 阻塞渲染
 *   - IntersectionObserver 处理 display:none → visible 的重新渲染
 */
import { useRef, useEffect, useCallback, useState, memo } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { Play, Pause, Square, RotateCcw, Loader } from 'lucide-react';
import { initChordTooltip, destroyChordTooltip } from '../chord-tooltip';
import { postProcessScore, patchLoadMidiForScore, type PostProcessOptions } from '../../core/post-process/score-post-process';
import { createMarkerOverlapFixer } from '../../core/post-process/marker-overlap-fix';
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
  // 保存 score model 引用，用于 renderFinished 里恢复 isDead
  const scoreRef = useRef<any>(null);
  // 播放进度用 ref 缓冲 + rAF 节流，避免高频 setState 阻塞主线程
  const pendingTimeRef = useRef<{ current: number; end: number } | null>(null);
  const rafIdRef = useRef(0);
  // x 品位标记开关（localStorage 持久化）
  const [showXMarks, setShowXMarks] = useState(() => {
    try { return localStorage.getItem('lyrichord-x-marks') !== '0'; } catch { return true; }
  });
  const showXMarksRef = useRef(showXMarks);

  // ── AlphaTab 初始化 (只执行一次) ──────────────────────────
  // 使用 SettingsJson 对象（官方 vite-react 示例推荐方式）
  // 而非 new Settings() 实例，避免 tree-shaking 问题
  useEffect(() => {
    if (!containerRef.current) return;

    const settings: alphaTab.json.SettingsJson = {
      core: {
        fontDirectory: '/font/',   // Bravura 音乐字体目录
        engine: 'svg',             // SVG 渲染引擎（比 canvas 更清晰）
        logLevel: 'warning',
        useWorkers: true,          // Web Worker 异步渲染，不阻塞主线程
      },
      display: {
        staveProfile: 'tab',       // 只显示 TAB 谱（不显示五线谱）
        layoutMode: 'page',        // 分页布局（vs 'horizontal' 横向滚动）
        scale: 1.0,
        // padding 配置 — 给段落名/BPM 标记留出空间
        firstNotationStaffPaddingTop: 30,
        effectBandPaddingBottom: 20,
      },
      notation: {
        rhythmMode: 'ShowWithBars',  // 在 TAB 谱下方显示节奏符干
        rhythmHeight: 20,
        elements: {
          effectLyrics: true,        // 显示歌词
          effectChordNames: true,    // 显示和弦名
          chordDiagrams: true,       // 显示和弦指法图（每个和弦首次出现时）
          chordDiagramFretboardNumbers: true, // 和弦图品位数字
          effectMarker: true,        // 显示段落标记 (Intro/Verse/Chorus)
          effectTempo: true,         // 显示速度标记
          effectCapo: false,
          effectDynamics: false,
          effectLetRing: false,      // ← 隐藏 let ring 虚线标记（音效仍生效）
          effectPalmMute: false,     // ← 隐藏 palm mute 标记
        } as any,
      },
      player: {
        enablePlayer: true,
        enableCursor: true,          // 播放时显示光标跟踪
        enableUserInteraction: true, // 允许点击谱面跳转
        scrollMode: 'continuous',    // 播放时自动滚动
        // GM SoundFont — MuseScore General (38MB, 高质量吉他采样)
        // 支持 SF2 和 SF3 格式，SF3 = SF2 + Ogg Vorbis 压缩
        soundFont: '/soundfont/MuseScore_General.sf3',
      },
    };
    const api = new alphaTab.AlphaTabApi(containerRef.current, settings);
    apiRef.current = api;

    // ── monkey-patch loadMidiForScore ──────────────────────
    // MIDI 生成前临时恢复 isDead=false，生成后改回 true。
    // 详见 src/core/post-process/score-post-process.ts
    patchLoadMidiForScore(api, scoreRef);

    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));

    api.playerReady.on(() => {
      console.log('AlphaTab player ready');
      setPlayerReady(true);
    });

    api.error.on((e: { message?: string; type?: string }) => {
      console.error('AlphaTab error:', e);
    });

    api.scoreLoaded.on((score: any) => {
      if (!score) return;
      scoreRef.current = score;
      postProcessScore(score, { enableXMarks: showXMarksRef.current });
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

    // ── 播放进度 — rAF 节流 ─────────────────────────────────
    // AlphaTab 的 playerPositionChanged 事件触发频率很高（~60fps），
    // 直接 setState 会导致 React 高频重渲染，阻塞主线程。
    // 方案: 用 ref 缓冲最新值，requestAnimationFrame 合并更新。
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

    // ── Marker/Chord 重叠修复 ──────────────────────────────
    // 详见 src/core/post-process/marker-overlap-fix.ts
    const fixMarkerOverlap = createMarkerOverlapFixer(() => containerRef.current);
    api.postRenderFinished.on(fixMarkerOverlap);
    api.renderer.partialRenderFinished.on(fixMarkerOverlap);

    // ── 可见性监听 ─────────────────────────────────────────
    // 容器从 display:none 恢复可见时触发重新渲染（解决白屏问题）。
    // 播放中跳过 re-render，避免阻塞主线程导致音频卡顿。
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

  // x 标记开关切换 → 重新处理 score model 并 re-render
  useEffect(() => {
    showXMarksRef.current = showXMarks;
    try { localStorage.setItem('lyrichord-x-marks', showXMarks ? '1' : '0'); } catch {}
    const score = scoreRef.current;
    const api = apiRef.current;
    if (!score || !api) return;
    postProcessScore(score, { enableXMarks: showXMarks });
    api.render();
  }, [showXMarks]);

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
          <button
            className={`btn-player ${showXMarks ? 'btn-player--active' : ''}`}
            onClick={() => setShowXMarks(v => !v)}
            title={showXMarks ? '关闭和弦 x 标记（显示品位数字）' : '开启和弦 x 标记'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="0" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              <line x1="0" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              <line x1="0" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              <text x="7" y="10.5" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="900" fontFamily="system-ui, sans-serif">x</text>
            </svg>
          </button>
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
