/**
 * TAB 工作区 — 组合段落导航 + TAB 编辑器
 *
 * 项目由 App 层管理，这里只管段落。
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

interface TabWorkspaceProps {
  projectId: string | null;
  onTmdChange?: (tmd: string) => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: string | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

const SEG_KEY = 'tab-workspace-segment';

export function TabWorkspace({
  projectId,
  onTmdChange, onChordSelectionStart, chordToApply,
  onChordApplied, onChordClick, previewOpen, onTogglePreview,
}: TabWorkspaceProps) {
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [activeSegId, setActiveSegId] = useState<string | null>(() => {
    try { return localStorage.getItem(SEG_KEY) || null; } catch { return null; }
  });
  const [segmentName, setSegmentName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [editorBpm, setEditorBpm] = useState(8);
  const [editorTsLabel, setEditorTsLabel] = useState('4/4');
  const [editorMeasures, setEditorMeasures] = useState<TabMeasure[] | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  // 持久化活跃段落
  useEffect(() => {
    try { localStorage.setItem(SEG_KEY, activeSegId ?? ''); } catch {}
  }, [activeSegId]);

  // 加载段落列表
  const refreshSegments = useCallback(async () => {
    const list = projectId
      ? await getSegmentsByProject(projectId)
      : await getOrphanSegments();
    setSegments(list);
    return list;
  }, [projectId]);

  useEffect(() => { refreshSegments(); }, [refreshSegments]);

  // 项目切换时重置段落状态
  const prevProjectId = useRef(projectId);
  useEffect(() => {
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId;
      setActiveSegId(null);
      setEditorMeasures(null);
      setSegmentName('');
      setEditorKey(k => k + 1);
    }
  }, [projectId]);

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

  // 选择段落
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
        segments={segments}
        activeSegmentId={activeSegId}
        onSelectSegment={handleSelectSegment}
        onNewSegment={handleNewSegment}
        onDeleteSegment={handleDeleteSegment}
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
