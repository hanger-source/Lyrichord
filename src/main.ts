/**
 * Lyrichord 入口
 * 
 * 胶水层：初始化所有模块，绑定 DOM 事件。
 */
import { TmdEditor } from './ui/editor';
import { ScoreRenderer } from './ui/renderer';
import { PlaybackController } from './ui/player';
import { EditorScoreSync } from './ui/sync';
import type { PipelineResult } from './core/pipeline';
import demoTmd from './data/demo-you-man-wo-man.tmd?raw';

async function main() {
  // ---- DOM 元素 ----
  const editorEl = document.getElementById('tmd-editor') as HTMLTextAreaElement;
  const containerEl = document.getElementById('alphatab-container') as HTMLElement;
  const btnRender = document.getElementById('btn-render') as HTMLButtonElement;
  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
  const bpmInput = document.getElementById('bpm-input') as HTMLInputElement;

  if (!editorEl || !containerEl) {
    console.error('缺少必要的 DOM 元素');
    return;
  }

  // ---- 初始化编辑器 ----
  const editor = new TmdEditor({
    element: editorEl,
    onChange: () => {
      // 编辑器内容变更时自动同步（防抖已在 TmdEditor 内部处理）
      sync.sync();
    },
    debounceMs: 600,
  });

  // 加载 demo 数据
  editor.setContent(demoTmd);

  // ---- 初始化渲染器 ----
  const renderer = new ScoreRenderer({
    container: containerEl,
    soundFontUrl: '/soundfont/sonivox.sf2',
  });

  try {
    await renderer.init();
    console.log('AlphaTab 渲染器初始化完成');
  } catch (e) {
    console.error('AlphaTab 初始化失败:', e);
  }

  // ---- 初始化播放器 ----
  const player = new PlaybackController({
    renderer,
    onStateChange: (state) => {
      btnPlay.textContent = state === 'playing' ? '⏸' : '▶';
    },
  });

  // ---- 初始化同步器 ----
  const sync = new EditorScoreSync({
    editor,
    renderer,
    onResult: (result: PipelineResult) => {
      if (result.errors.length > 0) {
        console.warn('管线错误:', result.errors);
      }
      if (result.warnings.length > 0) {
        console.info('管线警告:', result.warnings);
      }
      if (result.output) {
        console.log('生成的 AlphaTex:\n', result.output.tex);
      }
    },
  });

  // ---- 绑定按钮事件 ----
  btnRender.addEventListener('click', () => {
    sync.sync();
  });

  btnPlay.addEventListener('click', () => {
    player.playPause();
  });

  btnStop.addEventListener('click', () => {
    player.stop();
  });

  bpmInput.addEventListener('change', () => {
    const bpm = parseInt(bpmInput.value, 10);
    if (bpm > 0) {
      // BPM 变更 → 调整播放速度（相对于曲谱中定义的 tempo）
      // 这里简化处理：直接设置 playbackSpeed 比例
      player.setPlaybackSpeed(bpm / 72); // 72 是默认 tempo
    }
  });

  // ---- 首次渲染 ----
  sync.sync();
}

// 启动
main().catch(console.error);
