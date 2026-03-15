/**
 * 段落导航面板 — TAB 工作区左侧
 *
 * 项目选择 + 段落列表 + 新建/删除
 */
import { useState, useEffect, useCallback } from 'react';
import * as Select from '@radix-ui/react-select';
import { Plus, Trash2, FolderOpen, ChevronDown, Check } from 'lucide-react';
import { getAllScores, type ScoreRecord } from '../../db/score-repo';
import type { SegmentRecord } from '../../db/segment-repo';

interface SegmentNavProps {
  projectId: string | null;
  onProjectChange: (id: string | null, title: string) => void;
  segments: SegmentRecord[];
  activeSegmentId: string | null;
  onSelectSegment: (seg: SegmentRecord) => void;
  onNewSegment: () => void;
  onDeleteSegment: (id: string) => void;
  onNewProject: (title: string) => void;
}

export function SegmentNav({
  projectId, onProjectChange,
  segments, activeSegmentId,
  onSelectSegment, onNewSegment, onDeleteSegment,
  onNewProject,
}: SegmentNavProps) {
  const [projects, setProjects] = useState<ScoreRecord[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');

  useEffect(() => {
    getAllScores().then(setProjects).catch(console.error);
  }, [projectId]);

  const handleCreateProject = useCallback(() => {
    const title = newProjectTitle.trim();
    if (!title) return;
    onNewProject(title);
    setNewProjectTitle('');
    setShowNewProject(false);
  }, [newProjectTitle, onNewProject]);

  return (
    <div className="seg-nav">
      {/* 项目选择 */}
      <div className="seg-nav-project">
        <div className="seg-nav-project-header">
          <FolderOpen size={13} />
          <span className="seg-nav-label">项目</span>
        </div>
        <Select.Root
          value={projectId ?? '__none__'}
          onValueChange={val => {
            const id = val === '__none__' ? null : val;
            const p = projects.find(p => p.id === id);
            onProjectChange(id, p?.title ?? '');
          }}
        >
          <Select.Trigger className="radix-select-trigger">
            <Select.Value />
            <Select.Icon className="radix-select-icon">
              <ChevronDown size={12} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="radix-select-content" position="popper" sideOffset={4}>
              <Select.Viewport className="radix-select-viewport">
                <Select.Item className="radix-select-item" value="__none__">
                  <Select.ItemText>未关联项目</Select.ItemText>
                  <Select.ItemIndicator className="radix-select-indicator">
                    <Check size={11} />
                  </Select.ItemIndicator>
                </Select.Item>
                {projects.map(p => (
                  <Select.Item key={p.id} className="radix-select-item" value={p.id}>
                    <Select.ItemText>{p.title}{p.artist ? ` — ${p.artist}` : ''}</Select.ItemText>
                    <Select.ItemIndicator className="radix-select-indicator">
                      <Check size={11} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        {!showNewProject ? (
          <button className="seg-nav-new-project-btn" onClick={() => setShowNewProject(true)}>
            <Plus size={11} /> 新项目
          </button>
        ) : (
          <div className="seg-nav-new-project-form">
            <input
              className="seg-nav-new-project-input"
              placeholder="项目名称"
              value={newProjectTitle}
              onChange={e => setNewProjectTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setShowNewProject(false); }}
              autoFocus
            />
            <button className="seg-nav-new-project-ok" onClick={handleCreateProject}>✓</button>
          </div>
        )}
      </div>

      {/* 段落列表 */}
      <div className="seg-nav-list-header">
        <span className="seg-nav-label">段落</span>
        <span className="seg-nav-count">{segments.length}</span>
      </div>
      <div className="seg-nav-list">
        {segments.length === 0 ? (
          <div className="seg-nav-empty">点击下方新建段落</div>
        ) : segments.map(seg => (
          <div
            key={seg.id}
            className={`seg-nav-item ${seg.id === activeSegmentId ? 'seg-nav-item--active' : ''}`}
            onClick={() => onSelectSegment(seg)}
          >
            <span className="seg-nav-item-name">{seg.name}</span>
            <span className="seg-nav-item-meta">{seg.tsLabel} · {countMeasures(seg.measuresJson)}小节</span>
            <button
              className="seg-nav-item-del"
              onClick={e => { e.stopPropagation(); onDeleteSegment(seg.id); }}
              title="删除段落"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      <button className="seg-nav-add-btn" onClick={onNewSegment}>
        <Plus size={13} /> 新建段落
      </button>
    </div>
  );
}

function countMeasures(json: string): number {
  try { return JSON.parse(json).length; } catch { return 0; }
}
