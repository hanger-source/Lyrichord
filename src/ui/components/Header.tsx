/**
 * 顶部导航栏
 */
import { Guitar, Music, Drum, Library, PenLine, Save, Sun, Moon, TableProperties } from 'lucide-react';
import type { SidebarTab } from '../hooks/useAppState';

interface HeaderProps {
  onSave: () => void;
  isSaving: boolean;
  sidebarTab: SidebarTab;
  onToggleSidebar: (tab: SidebarTab) => void;
  saveMessage: string | null;
  dbReady: boolean;
  currentScoreId: string | null;
  editorCollapsed: boolean;
  onToggleEditor: () => void;
  editorMode: 'tmd' | 'tab';
  onSetEditorMode: (mode: 'tmd' | 'tab') => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

export function Header({
  onSave, isSaving, sidebarTab, onToggleSidebar,
  saveMessage, dbReady, currentScoreId,
  editorCollapsed, onToggleEditor,
  editorMode, onSetEditorMode,
  isDark, onToggleTheme,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-left">
        <Guitar size={20} className="logo-icon" />
        <h1 className="app-title">Lyrichord</h1>
        <span className="app-subtitle">歌弦</span>
        {!dbReady && <span className="db-loading">数据库加载中...</span>}
      </div>

      <nav className="header-nav">
        <button
          className={`nav-btn ${!editorCollapsed && editorMode === 'tmd' ? 'nav-btn--active' : ''}`}
          onClick={() => { if (editorCollapsed) onToggleEditor(); onSetEditorMode('tmd'); }}
        >
          <PenLine size={14} />
          <span>编辑器</span>
        </button>
        <button
          className={`nav-btn ${!editorCollapsed && editorMode === 'tab' ? 'nav-btn--active' : ''}`}
          onClick={() => { if (editorCollapsed) onToggleEditor(); onSetEditorMode('tab'); }}
        >
          <TableProperties size={14} />
          <span>TAB</span>
        </button>
        <span className="nav-divider" />
        <NavButton icon={<Music size={14} />} label="和弦库" tab="chords" active={sidebarTab} onToggle={onToggleSidebar} />
        <NavButton icon={<Drum size={14} />} label="节奏型" tab="rhythms" active={sidebarTab} onToggle={onToggleSidebar} />
        <NavButton icon={<Library size={14} />} label="谱库" tab="scores" active={sidebarTab} onToggle={onToggleSidebar} />
      </nav>

      <div className="header-right">
        {saveMessage && <span className="save-toast">{saveMessage}</span>}
        <button
          className="btn-tiny"
          onClick={onToggleTheme}
          title={isDark ? '切换到亮色主题' : '切换到暗色主题'}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="btn-save"
          onClick={onSave}
          disabled={isSaving || !dbReady}
        >
          <Save size={14} />
          <span>{isSaving ? '保存中...' : currentScoreId ? '更新' : '保存'}</span>
        </button>
      </div>
    </header>
  );
}

function NavButton({ icon, label, tab, active, onToggle }: {
  icon: React.ReactNode; label: string; tab: SidebarTab & string;
  active: SidebarTab; onToggle: (tab: SidebarTab) => void;
}) {
  return (
    <button
      className={`nav-btn ${active === tab ? 'nav-btn--active' : ''}`}
      onClick={() => onToggle(tab)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
