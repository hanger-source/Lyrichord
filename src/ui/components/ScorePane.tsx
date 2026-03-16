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

    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));

    api.playerReady.on(() => {
      console.log('AlphaTab player ready');
      setPlayerReady(true);
    });

    api.error.on((e: { message?: string; type?: string }) => {
      console.error('AlphaTab error:', e);
    });

    // ── let ring 注入 ──────────────────────────────────────
    // 吉他拨弦后的余音衰减效果。在 score model 加载后遍历所有音符，
    // 给非 dead note / 非 palm mute 的音符设置 isLetRing = true。
    //
    // 为什么不在 AlphaTex 里加 {lr}:
    //   1. 会让 AlphaTex 文本膨胀（每个音符都要加）
    //   2. scoreLoaded 回调直接改 model 更干净
    //
    // 为什么不用 SustainPedalMarker:
    //   AlphaTab 的 SustainPedalMarker 构造函数未导出为公开 API，
    //   运行时会报 "not a constructor" 错误。
    api.scoreLoaded.on((score: any) => {
      if (!score) return;

      // ── 和弦图显示位置 ──────────────────────────────────
      // globalDisplayChordDiagramsOnTop: 谱头汇总（默认 true）
      // globalDisplayChordDiagramsInScore: 谱内小节上方（默认 false）
      // 两者可以同时开启，这里开启谱内显示，关闭谱头汇总
      if (score.stylesheet) {
        score.stylesheet.globalDisplayChordDiagramsOnTop = true;
        score.stylesheet.globalDisplayChordDiagramsInScore = true;
      }

      for (const track of score.tracks) {
        for (const staff of track.staves) {
          for (const bar of staff.bars) {
            for (const voice of bar.voices) {
              for (const beat of voice.beats) {
                for (const note of beat.notes) {
                  // 跳过 dead note 和 palm mute
                  if (!note.isDead && !note.isPalmMute) {
                    note.isLetRing = true;
                  }
                }
              }
            }
          }

          // ── chord diagram firstFret 自动计算 ──────────────
          // AlphaTab \chord 传的是绝对品位，渲染时用 fret -= (firstFret-1)
          // 转为网格相对位置。网格只有 5 格，所以高把位和弦必须设置 firstFret。
          //
          // staff.chords 是 Map<string, Chord> | null
          // Chord.strings: number[] — 从高弦(1弦)到低弦(6弦)，-1=不弹
          // Chord.firstFret: number — 默认 1
          //
          // 规则:
          //   minFret <= 4  → firstFret=1（低把位，画琴枕粗线）
          //   minFret >= 5  → firstFret=minFret（高把位，左侧标起始品位号）
          //
          // AlphaTab 渲染逻辑:
          //   firstFret=1 → 画琴枕粗线，不标品位号
          //   firstFret>1 → 不画琴枕，左侧标品位号
          if (staff.chords) {
            for (const [, chord] of staff.chords) {
              if (!chord || !chord.strings) continue;
              const played = chord.strings.filter((f: number) => f > 0);
              if (played.length === 0) continue;
              const minFret = Math.min(...played);
              if (minFret >= 5) {
                chord.firstFret = minFret;
              }
              // minFret <= 4: 保持默认 firstFret=1（琴枕粗线 + 从第1品开始画）
            }
          }
        }
      }
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

    // ── Marker/Chord 重叠修复 hack ──────────────────────────
    // AlphaTab bug: section marker (段落名) 和 chord name 放在同一个
    // effect band slot（相同 Y 坐标），导致文字重叠。
    // 修复方式: 渲染完成后用 DOM 操作把 Marker + Tempo 整体上移。
    //
    // 识别方式:
    //   - 段落名: <text> 元素，bold Georgia 字体，左对齐
    //   - BPM: 同上但内容匹配 /=\s*\d/（如 "♩= 72"）
    //   - 音符符号: <g class="at"> 内的 Bravura 字体文本
    const SECTION_SHIFT = -32;  // 段落名偏移量 (px)
    const TEMPO_SHIFT = -16;    // BPM/音符符号偏移
    const fixMarkerOverlap = () => {
      if (!containerRef.current) return;
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!containerRef.current) return;
          const texts = containerRef.current.querySelectorAll('text');
          for (const t of texts) {
            if (t.hasAttribute('data-marker-fixed')) continue;
            const style = t.getAttribute('style') || '';
            const isBoldGeorgia = /\bbold\b/.test(style) && /Georgia/i.test(style);
            const isLeftAligned = !t.hasAttribute('text-anchor');
            if (isBoldGeorgia && isLeftAligned) {
              const content = t.textContent || '';
              const isTempo = /=\s*\d/.test(content);
              const shift = isTempo ? TEMPO_SHIFT : SECTION_SHIFT;
              const y = parseFloat(t.getAttribute('y') || '0');
              t.setAttribute('y', String(y + shift));
              t.setAttribute('data-marker-fixed', '1');
              t.setAttribute('data-marker-type', isTempo ? 'tempo' : 'section');
            }
          }
          // 移动音符符号 ♩（Bravura 音乐字体，在 <g class="at"> 里）
          const groups = containerRef.current.querySelectorAll('g.at');
          for (const g of groups) {
            if (g.hasAttribute('data-marker-fixed')) continue;
            const transform = g.getAttribute('transform') || '';
            const match = transform.match(/translate\(\s*([\d.]+)\s+([\d.]+)\s*\)/);
            if (!match) continue;
            const innerText = g.querySelector('text');
            if (!innerText) continue;
            const innerStyle = innerText.getAttribute('style') || '';
            if (innerStyle.includes('Georgia') || innerStyle.includes('italic')) continue;
            const parentSvg = g.closest('svg');
            if (!parentSvg) continue;
            const tempoMarker = parentSvg.querySelector('text[data-marker-type="tempo"]');
            if (!tempoMarker) continue;
            const gY = parseFloat(match[2]);
            const markerY = parseFloat(tempoMarker.getAttribute('y') || '0') - TEMPO_SHIFT;
            if (Math.abs(gY - markerY) < 15) {
              const newY = gY + TEMPO_SHIFT;
              g.setAttribute('transform', `translate(${match[1]} ${newY})`);
              g.setAttribute('data-marker-fixed', '1');
            }
          }
        }, 50);
      });
    };
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
