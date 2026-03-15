/**
 * TMD 行级装饰 — CodeMirror 6 ViewPlugin
 *
 * 给特定行类型添加 CSS class，实现：
 *   - [SectionName] 段落标记行 → 背景色块 + 上方间距
 *   - --- header 分隔符 → 分隔线
 *   - header 区域内的行 → 淡色背景
 *   - # 注释行 → 淡化
 *   - w: / w2: 歌词行 → 微弱背景区分
 *   - tex: 行 → 微弱背景区分
 *
 * 扩展方式：在 buildDecorations 里加新的行类型判断 + CSS class
 */
import { EditorView, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/** 行装饰（整行 CSS class） */
const sectionDeco = Decoration.line({ class: 'tmd-line-section' });
const headerDelimDeco = Decoration.line({ class: 'tmd-line-header-delim' });
const headerDeco = Decoration.line({ class: 'tmd-line-header' });
const commentDeco = Decoration.line({ class: 'tmd-line-comment' });
const lyricsDeco = Decoration.line({ class: 'tmd-line-lyrics' });
const texDeco = Decoration.line({ class: 'tmd-line-tex' });
const measureDeco = Decoration.line({ class: 'tmd-line-measure' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  let inHeader = false;
  let delimCount = 0;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text.trim();

    if (text === '---') {
      delimCount++;
      builder.add(line.from, line.from, headerDelimDeco);
      inHeader = delimCount === 1;
      if (delimCount === 2) inHeader = false;
      continue;
    }

    if (inHeader) {
      builder.add(line.from, line.from, headerDeco);
      continue;
    }

    // body 区域
    if (text.startsWith('[') && text.includes(']')) {
      builder.add(line.from, line.from, sectionDeco);
    } else if (text.startsWith('#')) {
      builder.add(line.from, line.from, commentDeco);
    } else if (text.startsWith('w:') || text.startsWith('w2:')) {
      builder.add(line.from, line.from, lyricsDeco);
    } else if (text.startsWith('tex:')) {
      builder.add(line.from, line.from, texDeco);
    } else if (text.startsWith('|')) {
      builder.add(line.from, line.from, measureDeco);
    }
  }

  return builder.finish();
}

/** ViewPlugin — 文档变化时重建装饰 */
export const tmdDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations }
);

/** 行装饰对应的 CSS 样式（作为 CodeMirror theme extension） */
export const tmdDecorationTheme = EditorView.baseTheme({
  /* 段落标记行 — 醒目背景 + 上方间距 */
  '.tmd-line-section': {
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
    borderTop: '2px solid rgba(217, 119, 6, 0.25)',
    marginTop: '12px',
    paddingTop: '2px',
    paddingBottom: '2px',
    borderRadius: '2px',
  },
  /* --- 分隔符 — 水平线效果 */
  '.tmd-line-header-delim': {
    backgroundColor: 'rgba(107, 114, 128, 0.08)',
    borderBottom: '1px solid rgba(107, 114, 128, 0.2)',
  },
  /* header 区域 — 淡色背景 */
  '.tmd-line-header': {
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
  },
  /* 注释行 — 淡化 */
  '.tmd-line-comment': {
    opacity: '0.6',
  },
  /* 歌词行 — 微弱绿色背景 */
  '.tmd-line-lyrics': {
    backgroundColor: 'rgba(22, 163, 74, 0.04)',
  },
  /* tex 行 — 微弱橙色背景 */
  '.tmd-line-tex': {
    backgroundColor: 'rgba(217, 119, 6, 0.04)',
  },
  /* 小节行 — 无特殊背景，但可以加 */
  '.tmd-line-measure': {},
});
