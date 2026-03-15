/**
 * Lyrichord 主应用组件
 */
import { useAppState } from './hooks/useAppState';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EditorPane } from './components/EditorPane';
import { ScorePane } from './components/ScorePane';
import demoTmd from '../data/demo-you-man-wo-man.tmd?raw';

export function App() {
  const state = useAppState(demoTmd);

  // DB 初始化错误
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
        onSave={state.handleSave}
        isSaving={state.isSaving}
        sidebarTab={state.sidebarTab}
        onToggleSidebar={state.setSidebarTab}
        saveMessage={state.saveMessage}
        dbReady={state.dbReady}
        currentScoreId={state.currentScoreId}
      />
      <div className="main-layout">
        {state.sidebarTab && (
          <Sidebar
            tab={state.sidebarTab}
            song={state.pipelineResult?.song ?? null}
            currentScoreId={state.currentScoreId}
            onSelectScore={(id, tmd) => {
              state.setCurrentScoreId(id);
              state.setTmdSource(tmd);
            }}
            onDeleteScore={state.handleDeleteScore}
            onLoadVersion={state.loadVersion}
          />
        )}
        <EditorPane
          source={state.tmdSource}
          onChange={state.setTmdSource}
          errors={state.pipelineResult?.errors ?? []}
          warnings={state.pipelineResult?.warnings ?? []}
        />
        <ScorePane
          pipelineResult={state.pipelineResult}
          playbackState={state.playbackState}
          onPlaybackStateChange={state.setPlaybackState}
        />
      </div>
    </div>
  );
}
