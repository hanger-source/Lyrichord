/**
 * TAB 工作区 — 组合段落导航 + TAB 编辑器
 *
 * 管理: 当前项目、段落列表、段落加载/保存
 * TabEditor 只负责编辑 measures 数据
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { SegmentNav } from './SegmentNav';
import { TabEditor } from './TabEditor';
import type { ChordSelectionPending, TabMeasure } from './TabEditor';
import {
  getSegmentsByProject, getOrphanSegments,
  saveSegment, deleteSegment,
  type SegmentRecord,
} from '../../db/segment-repo';
import { getDb, persist } from '../../db/connection';

interface TabWorkspaceProps {
  onTmdChange?: (tmd: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: string | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

const WS_KEY = 'tab-workspace-state';

function loadWsState(): { projectId: string | null; segmentId: string | null } {
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { projectId: null, segmentId: null };
}

export function TabWorkspace({
  onTmdChange, onChordSelectionStart, chordToApply,
  onChordApplied, onChordClick, previewOpen, onTogglePreview,
}: TabWorkspaceProps) {
  const wsState = useRef(loadWsState());
  const [projectId, setProjectId] = useState<string | null>(wsState.current.projectId);
  const [projectTitle, setProjectTitle] = useState('');
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [activeSegId, setActiveSegId] = useState<string | null>(wsState.current.segmentId);
  const [segmentName, setSegmentName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 编辑器数据 — 由 workspace 管理，传给 TabEditor
  const [editorBpm, setEditorBpm] = useState(8);
  const [editorTsLabel, setEditorTsLabel] = useState('4/4');
  const [editorMeasures, setEditorMeasures] = useState<TabMeasure[] | null>(null);
  // editorKey 只在用户主动切换/新建段落时递增，保存不触发重建
  const [editorKey, setEditorKey] = useState(0);

  // 持久化 workspace 状态
  useEffect(() => {
    try { localStorage.setItem(WS_KEY, JSON.stringify({ projectId, segmentId: activeSegId })); } catch {}
  }, [projectId, activeSegId]);

  // 加载段落列表
  const refreshSegments = useCallback(async () => {
    const list = projectId
      ? await getSegmentsByProject(projectId)
      : await getOrphanSegments();
    setSegments(list);
    return list;
  }, [projectId]);

  useEffect(() => { refreshSegments(); }, [refreshSegments]);

  // 启动时自动恢复上次活跃的段落
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || segments.length === 0 || !activeSegId) return;
    const seg = segments.find(s => s.id === activeSegId);
    if (seg) {
      restoredRef.current = true;
      try {
        const parsed = JSON.parse(seg.measuresJson) as TabMeasure[];
        setEditorMeasures(parsed);
        setEditorBpm(seg.bpm);
        setEditorTsLabel(seg.tsLabel);
        setSegmentName(seg.name);
        setEditorKey(k => k + 1);
      } catch (e) {
        console.error('恢复段落失败:', e);
      }
    }
  }, [segments, activeSegId]);

  // 切换项目
  const handleProjectChange = useCallback((id: string | null, title: string) => {
    setProjectId(id);
    setProjectTitle(title);
    setActiveSegId(null);
    setEditorMeasures(null);
    setSegmentName('');
    setEditorKey(k => k + 1);
  }, []);

  // 新建项目
  const handleNewProject = useCallback(async (title: string) => {
    const db = await getDb();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    db.run('INSERT INTO scores (id, title) VALUES (?, ?)', [id, title]);
    await persist();
    setProjectId(id);
    setProjectTitle(title);
    setActiveSegId(null);
    setEditorMeasures(null);
    setSegmentName('');
  }, []);

  // 选择段落 → 加载到编辑器
  const handleSelectSegment = useCallback((seg: SegmentRecord) => {
    try {
      const parsed = JSON.parse(seg.measuresJson) as TabMeasure[];
      setEditorMeasures(parsed);
      setEditorBpm(seg.bpm);
      setEditorTsLabel(seg.tsLabel);
      setActiveSegId(seg.id);
      setSegmentName(seg.name);
      setEditorKey(k => k + 1);
    } catch (e) {
      console.error('加载段落失败:', e);
    }
  }, []);

  // 新建段落
  const handleNewSegment = useCallback(() => {
    setActiveSegId(null);
    setEditorMeasures(null);
    setSegmentName('');
    setEditorKey(k => k + 1);
  }, []);

  // 删除段落
  const handleDeleteSegment = useCallback(async (id: string) => {
    await deleteSegment(id);
    if (activeSegId === id) {
      setActiveSegId(null);
      setEditorMeasures(null);
      setSegmentName('');
      setEditorKey(k => k + 1);
    }
    await refreshSegments();
  }, [activeSegId, refreshSegments]);

  // 保存段落
  const showSaveMsg = useCallback((msg: string) => {
    setSaveMsg(msg);
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 2500);
  }, []);

  const handleSave = useCallback(async (measures: TabMeasure[], bpm: number, tsLabel: string) => {
    // 安全检查：如果所有小节都是空的（无和弦、无品位数据），提示用户
    const hasAnyContent = measures.some(m =>
      m.chords.length > 0 ||
      m.beats.some(b => b.rest || b.strings.some(s => s.type !== 'none'))
    );
    if (!hasAnyContent && activeSegId) {
      const ok = window.confirm('当前段落内容为空，确定要覆盖已保存的数据吗？');
      if (!ok) return;
    }

    const name = segmentName.trim() || '未命名段落';
    setSaving(true);
    try {
      const rec = await saveSegment({
        id: activeSegId ?? undefined,
        name,
        projectId,
        bpm,
        tsLabel,
        measuresJson: JSON.stringify(measures),
      });
      setActiveSegId(rec.id);
      setSegmentName(rec.name);
      showSaveMsg(`已保存「${rec.name}」`);
      await refreshSegments();
    } catch (e) {
      console.error('保存段落失败:', e);
      showSaveMsg('保存失败');
    } finally {
      setSaving(false);
    }
  }, [segmentName, activeSegId, projectId, showSaveMsg, refreshSegments]);

  return (
    <div className="tab-workspace">
      <SegmentNav
        projectId={projectId}
        onProjectChange={handleProjectChange}
        segments={segments}
        activeSegmentId={activeSegId}
        onSelectSegment={handleSelectSegment}
        onNewSegment={handleNewSegment}
        onDeleteSegment={handleDeleteSegment}
        onNewProject={handleNewProject}
      />
      <div className="tab-workspace-main">
        <TabEditor
          key={editorKey}
          initialMeasures={editorMeasures}
          initialBpm={editorBpm}
          initialTsLabel={editorTsLabel}
          segmentName={segmentName}
          onSegmentNameChange={setSegmentName}
          onSave={handleSave}
          saving={saving}
          saveMsg={saveMsg}
          isUpdate={!!activeSegId}
          onTmdChange={onTmdChange}
          onChordSelectionStart={onChordSelectionStart}
          chordToApply={chordToApply}
          onChordApplied={onChordApplied}
          onChordClick={onChordClick}
          previewOpen={previewOpen}
          onTogglePreview={onTogglePreview}
        />
      </div>
    </div>
  );
}
