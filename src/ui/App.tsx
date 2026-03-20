/**
 * Lyrichord 主应用组件
 *
 * 布局: Header + [Editor(左) | Score(中) | Sidebar(右)]
 * 编辑器和侧边栏可折叠，曲谱始终占主区域。
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppState } from './hooks/useAppState';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EditorPane } from './components/EditorPane';
import type { EditorPaneHandle } from './components/EditorPane';
import { ScorePane } from './components/ScorePane';
import { TabWorkspace } from './components/TabWorkspace';
import type { TabWorkspaceHandle } from './components/TabWorkspace';
import type { ChordSelectionPending } from './components/TabEditor';
import type { RhythmPattern } from '../core/types';
import { applyTheme, lightColors, darkColors, layout } from './theme';
import type { ColorTokens } from './theme';
import { tmdToAlphaTex, type PipelineResult } from '../core/pipeline';

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function App() {
  const state = useAppState();
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [editorMode, setEditorMode] = useState<'tmd' | 'tab'>(() => {
    try {
      const saved = localStorage.getItem('lyrichord-editor-mode');
      if (saved === 'tmd' || saved === 'tab') return saved;
    } catch {}
    return 'tmd';
  });

  const setEditorModeAndSave = useCallback((mode: 'tmd' | 'tab') => {
    setEditorMode(mode);
    try { localStorage.setItem('lyrichord-editor-mode', mode); } catch {}
  }, []);
  const tabWorkspaceRef = useRef<TabWorkspaceHandle>(null);
  const editorPaneRef = useRef<EditorPaneHandle>(null);
  const [activeColors, setActiveColors] = useState<ColorTokens>(lightColors);
  // TAB 模式曲谱预览开关
  const [tabPreviewOpen, setTabPreviewOpen] = useState(() => {
    const saved = localStorage.getItem('tabPreviewOpen');
    return saved === null ? true : saved === '1';
  });
  // TAB ↔ 和弦库联动
  const [chordToApply, setChordToApply] = useState<{ name: string; positionIndex: number } | null>(null);
  const [highlightChord, setHighlightChord] = useState<{ name: string; positionIndex?: number } | null>(null);
  // TAB 编辑器独立的 TMD 输出 + pipeline 结果
  const [tabPipelineResult, setTabPipelineResult] = useState<PipelineResult | null>(null);

  const handleTabTmdChange = useCallback((tmd: string) => {
    if (tmd.trim()) {
      setTabPipelineResult(tmdToAlphaTex(tmd));
    } else {
      setTabPipelineResult(null);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setActiveColors(prev => {
      const next = prev === lightColors ? darkColors : lightColors;
      applyTheme({ ...next, ...layout });
      return next;
    });
  }, []);

  // TabEditor 拖选完成 → 打开侧边栏和弦库
  const handleChordSelectionStart = useCallback((_sel: ChordSelectionPending) => {
    // 自动打开和弦库侧边栏
    if (state.sidebarTab !== 'chords') {
      state.setSidebarTab('chords');
    }
  }, [state.sidebarTab, state.setSidebarTab]);

  // TabEditor 底部节奏型拖选完成 → 打开侧边栏节奏型库
  const handleRhythmSelectionStart = useCallback(() => {
    if (state.sidebarTab !== 'rhythms') {
      state.setSidebarTab('rhythms');
    }
  }, [state.sidebarTab, state.setSidebarTab]);

  // 侧边栏和弦库选中和弦
  // chordToApply 暂存：如果当前没有 pendingSel，先暂存和弦，等用户拖选后自动填入
  const handleChordPicked = useCallback((chordName: string, positionIndex: number) => {
    setChordToApply({ name: chordName, positionIndex });
  }, []);

  // TAB 编辑器点击和弦 → 高亮侧边栏对应卡片
  const handleChordClick = useCallback((chordName: string, positionIndex?: number) => {
    if (state.sidebarTab !== 'chords') state.setSidebarTab('chords');
    setHighlightChord({ name: chordName, positionIndex });
  }, [state.sidebarTab, state.setSidebarTab]);

  const handleChordApplied = useCallback(() => {
    setChordToApply(null);
  }, []);

  // Sidebar 切换指法变体 → 更新 TAB 里同名和弦的 positionIndex
  const handleChordPositionChange = useCallback((chordName: string, positionIndex: number) => {
    tabWorkspaceRef.current?.updateChordPosition(chordName, positionIndex);
  }, []);

  // Sidebar 编辑/新建/删除节奏型 → 同步 TMD 文本 + 刷新补全
  const handleRhythmChanged = useCallback((change?: { oldId?: string; pattern: RhythmPattern } | { deleted: string }) => {
    state.refreshCompletionData();
    // TAB 模式：刷新 TabWorkspace 的节奏型缓存，让 TMD 重新生成
    tabWorkspaceRef.current?.refreshRhythms();
    if (!change) return;

    // 只在 TMD 模式下同步文本（TAB 模式不涉及 TMD 编辑器）
    const tmd = state.tmdSource;
    if (!tmd) return;

    if ('deleted' in change) {
      // 删除：移除 TMD 里的定义行（@id: ...）
      const defRe = new RegExp(`^@${escapeRegex(change.deleted)}\\s*:.*$`, 'm');
      const updated = tmd.replace(defRe, '').replace(/\n{3,}/g, '\n\n');
      if (updated !== tmd) state.setTmdSource(updated);
      return;
    }

    const { oldId, pattern } = change;
    const newDef = `@${pattern.id}: ${pattern.type}(${pattern.raw})`;
    let updated = tmd;

    if (oldId && oldId !== pattern.id) {
      // ID 变了：替换定义行 + 替换所有引用
      const defRe = new RegExp(`^@${escapeRegex(oldId)}\\s*:.*$`, 'm');
      updated = updated.replace(defRe, newDef);
      // 替换和弦行里的 @oldId 引用（如 C@oldId → C@newId）
      const refRe = new RegExp(`@${escapeRegex(oldId)}\\b`, 'g');
      updated = updated.replace(refRe, `@${pattern.id}`);
    } else {
      // ID 没变：只更新定义行内容
      const defRe = new RegExp(`^@${escapeRegex(pattern.id)}\\s*:.*$`, 'm');
      if (defRe.test(updated)) {
        updated = updated.replace(defRe, newDef);
      }
      // 如果 TMD 里没有这个定义（新建的），不自动插入 — 用户手动引用
    }

    if (updated !== tmd) state.setTmdSource(updated);
  }, [state.tmdSource, state.setTmdSource, state.refreshCompletionData]);

  // Sidebar 节奏型库选中节奏型
  const handleRhythmPicked = useCallback((rhythm: RhythmPattern) => {
    if (editorMode === 'tab') {
      tabWorkspaceRef.current?.applyRhythm(rhythm);
    } else {
      editorPaneRef.current?.insertRhythmRef(rhythm.id);
    }
  }, [editorMode]);

  // 稳定引用 — 避免破坏 Sidebar/ScorePane 的 memo
  const handleSidebarSelectScore = useCallback((id: string, tmd: string) => {
    state.switchProject(id, '');
    state.setTmdSource(tmd);
  }, [state.switchProject, state.setTmdSource]);

  const handleHighlightClear = useCallback(() => {
    setHighlightChord(null);
  }, []);

  // Ctrl+S / Cmd+S → 保存（拦截浏览器默认行为）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editorMode === 'tab') {
          tabWorkspaceRef.current?.save();
        } else {
          state.handleSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editorMode, state.handleSave]);

  if (state.dbError) {
    return (
      <div className="app-root">
        <div className="app-error">
          <h2>数据库初始化失败</h2>
          <p>{state.dbError}</p>
          <p>请刷新页面重试，或清除浏览器数据后重新加载。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root">
      <Header
        sidebarTab={state.sidebarTab}
        onToggleSidebar={state.setSidebarTab}
        saveMessage={state.saveMessage}
        dbReady={state.dbReady}
        editorCollapsed={editorCollapsed}
        onToggleEditor={() => setEditorCollapsed(!editorCollapsed)}
        editorMode={editorMode}
        onSetEditorMode={setEditorModeAndSave}
        isDark={activeColors === darkColors}
        onToggleTheme={toggleTheme}
        activeProjectId={state.activeProjectId}
        activeProjectTitle={state.activeProjectTitle}
        projects={state.projects}
        onSwitchProject={state.switchProject}
        onCreateProject={state.createProject}
      />
      <div className="main-layout">
        {!editorCollapsed && editorMode === 'tmd' && (
          <EditorPane
            ref={editorPaneRef}
            source={state.tmdSource}
            onChange={state.setTmdSource}
            errors={state.pipelineResult?.errors ?? []}
            warnings={state.pipelineResult?.warnings ?? []}
            completionData={{
              chordNames: state.chordNames,
              rhythmIds: state.rhythmIds,
              segmentNames: state.segmentNames,
            }}
            saveMessage={state.saveMessage}
          />
        )}
        {!editorCollapsed && editorMode === 'tab' && (
          <div style={{ flex: '1 1 0', overflow: 'hidden', display: 'flex', minWidth: 0 }}>
            <TabWorkspace
              ref={tabWorkspaceRef}
              projectId={state.activeProjectId}
              onTmdChange={handleTabTmdChange}
              onSegmentSaved={state.refreshSegmentCache}
              onChordSelectionStart={handleChordSelectionStart}
              onRhythmSelectionStart={handleRhythmSelectionStart}
              chordToApply={chordToApply}
              onChordApplied={handleChordApplied}
              onChordClick={handleChordClick}
              previewOpen={tabPreviewOpen}
              onTogglePreview={() => setTabPreviewOpen(p => { const next = !p; localStorage.setItem('tabPreviewOpen', next ? '1' : '0'); return next; })}
            />
          </div>
        )}
        {/* TMD 模式曲谱 — 始终挂载，用 display 控制可见性 */}
        <div style={{ display: editorMode !== 'tab' ? 'flex' : 'none', flex: '1 1 0', overflow: 'hidden', flexDirection: 'column', minWidth: 0 }}>
          <ScorePane
            pipelineResult={state.pipelineResult}
            playbackState={state.playbackState}
            onPlaybackStateChange={state.setPlaybackState}
            colors={activeColors}
            visible={editorMode !== 'tab'}
          />
        </div>
        {/* TAB 模式曲谱 — 始终挂载，用 display 控制可见性 */}
        <div style={{ display: editorMode === 'tab' && tabPreviewOpen ? 'flex' : 'none', flex: 1, overflow: 'hidden', flexDirection: 'column', minWidth: 0 }}>
          <ScorePane
            pipelineResult={tabPipelineResult}
            playbackState={state.playbackState}
            onPlaybackStateChange={state.setPlaybackState}
            colors={activeColors}
            visible={editorMode === 'tab' && tabPreviewOpen}
          />
        </div>
        <div style={{ display: state.sidebarTab ? 'flex' : 'none' }}>
          <Sidebar
            tab={state.sidebarTab ?? 'chords'}
            song={editorMode === 'tab' ? (tabPipelineResult?.song ?? null) : (state.pipelineResult?.song ?? null)}
            currentScoreId={state.currentScoreId}
            onSelectScore={handleSidebarSelectScore}
            onDeleteScore={state.handleDeleteScore}
            onLoadVersion={state.loadVersion}
            onChordPick={editorMode === 'tab' ? handleChordPicked : undefined}
            highlightChord={highlightChord}
            onHighlightClear={handleHighlightClear}
            onChordPositionChange={editorMode === 'tab' ? handleChordPositionChange : undefined}
            onRhythmPick={handleRhythmPicked}
            onRhythmChanged={handleRhythmChanged}
          />
        </div>
      </div>
    </div>
  );
}
