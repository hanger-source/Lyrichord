/**
 * 顶部导航栏
 *
 * 包含: Logo + 项目选择器 | 模式切换 + 侧边栏 | 主题切换
 */
import { useState, useCallback } from 'react';
import { Guitar, Music, Drum, Library, PenLine, Sun, Moon, TableProperties, Plus, ChevronDown, Check, Settings } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';
import type { SidebarTab } from '../hooks/useAppState';
import type { ScoreRecord } from '../../db/score-repo';
import { DbToolsPanel } from './DbToolsPanel';

interface HeaderProps {
  sidebarTab: SidebarTab;
  onToggleSidebar: (tab: SidebarTab) => void;
  saveMessage: string | null;
  dbReady: boolean;
  editorCollapsed: boolean;
  onToggleEditor: () => void;
  editorMode: 'tmd' | 'tab';
  onSetEditorMode: (mode: 'tmd' | 'tab') => void;
  isDark: boolean;
  onToggleTheme: () => void;
  // 项目
  activeProjectId: string | null;
  activeProjectTitle: string;
  projects: ScoreRecord[];
  onSwitchProject: (id: string | null, title: string) => void;
  onCreateProject: (title: string) => void;
}

export function Header({
  sidebarTab, onToggleSidebar,
  saveMessage, dbReady,
  editorCollapsed, onToggleEditor,
  editorMode, onSetEditorMode,
  isDark, onToggleTheme,
  activeProjectId, activeProjectTitle, projects,
  onSwitchProject, onCreateProject,
}: HeaderProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleCreate = useCallback(() => {
    const t = newTitle.trim();
    if (!t) return;
    onCreateProject(t);
    setNewTitle('');
    setShowNewProject(false);
  }, [newTitle, onCreateProject]);

  return (
    <header className="app-header">
      <div className="header-left">
        <Guitar size={20} className="logo-icon" />
        <h1 className="app-title">Lyrichord</h1>
        <span className="app-subtitle">歌弦</span>
        {!dbReady && <span className="db-loading">数据库加载中...</span>}

        {/* 项目选择器 */}
        <div className="header-project">
          <Select.Root
            value={activeProjectId ?? ''}
            onValueChange={val => {
              if (val === '__new__') {
                setShowNewProject(true);
                return;
              }
              const p = projects.find(p => p.id === val);
              if (p) onSwitchProject(p.id, p.title);
            }}
          >
            <Select.Trigger className="radix-select-trigger">
              <Select.Value>
                {activeProjectTitle || '加载中...'}
              </Select.Value>
              <Select.Icon className="radix-select-icon">
                <ChevronDown size={12} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="radix-select-content" position="popper" sideOffset={4}>
                <Select.Viewport className="radix-select-viewport">
                  {projects.map(p => (
                    <Select.Item key={p.id} className="radix-select-item" value={p.id}>
                      <Select.ItemText>{p.title}{p.artist ? ` — ${p.artist}` : ''}</Select.ItemText>
                      <Select.ItemIndicator className="radix-select-indicator">
                        <Check size={11} />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                  <Select.Item className="radix-select-item" value="__new__">
                    <Select.ItemText>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
                        <Plus size={11} /> 新建项目
                      </span>
                    </Select.ItemText>
                  </Select.Item>
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          {showNewProject && (
            <div className="header-project-actions">
              <input
                style={{
                  fontSize: 13, padding: '4px 8px',
                  border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-input)', color: 'var(--text-primary)',
                  outline: 'none', width: 140,
                }}
                placeholder="项目名称"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNewProject(false); }}
                autoFocus
              />
              <button className="btn-tiny" onClick={handleCreate} style={{ color: 'var(--accent)' }}>✓</button>
              <button className="btn-tiny" onClick={() => setShowNewProject(false)}>✕</button>
            </div>
          )}
        </div>
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
        <button
          className="btn-tiny"
          onClick={onToggleTheme}
          title={isDark ? '切换到亮色主题' : '切换到暗色主题'}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button className="btn-tiny" title="数据库工具">
              <Settings size={15} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="radix-dialog-overlay" />
            <Dialog.Content className="radix-dialog-content radix-dialog-content--sm">
              <Dialog.Title className="radix-dialog-title">数据库工具</Dialog.Title>
              <DbToolsPanel />
              <Dialog.Close asChild>
                <button className="radix-dialog-close" aria-label="关闭">✕</button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
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
