/**
 * 顶部导航栏
 */
import type { SidebarTab } from '../hooks/useAppState';

interface HeaderProps {
  onSave: () => void;
  isSaving: boolean;
  sidebarTab: SidebarTab;
  onToggleSidebar: (tab: SidebarTab) => void;
  saveMessage: string | null;
  dbReady: boolean;
  currentScoreId: string | null;
}

export function Header({
  onSave, isSaving, sidebarTab, onToggleSidebar,
  saveMessage, dbReady, currentScoreId,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="app-title">🎸 Lyrichord</h1>
        <span className="app-subtitle">歌弦</span>
        {!dbReady && <span className="db-loading">数据库加载中...</span>}
      </div>

      <nav className="header-nav">
        <NavButton icon="🎵" label="和弦库" tab="chords" active={sidebarTab} onToggle={onToggleSidebar} />
        <NavButton icon="🥁" label="节奏型" tab="rhythms" active={sidebarTab} onToggle={onToggleSidebar} />
        <NavButton icon="📚" label="谱库" tab="scores" active={sidebarTab} onToggle={onToggleSidebar} />
      </nav>

      <div className="header-right">
        {saveMessage && <span className="save-toast">{saveMessage}</span>}
        <button
          className="btn-save"
          onClick={onSave}
          disabled={isSaving || !dbReady}
        >
          {isSaving ? '保存中...' : currentScoreId ? '💾 更新' : '💾 保存'}
        </button>
      </div>
    </header>
  );
}

function NavButton({ icon, label, tab, active, onToggle }: {
  icon: string; label: string; tab: SidebarTab & string;
  active: SidebarTab; onToggle: (tab: SidebarTab) => void;
}) {
  return (
    <button
      className={`nav-btn ${active === tab ? 'nav-btn--active' : ''}`}
      onClick={() => onToggle(tab)}
    >
      {icon} {label}
    </button>
  );
}
