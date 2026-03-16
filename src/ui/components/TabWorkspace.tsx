/**
 * TAB 工作区 — 组合段落导航 + TAB 编辑器
 *
 * 项目由 App 层管理，这里只管段落。
 */
import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { SegmentNav } from './SegmentNav';
import { TabEditor } from './TabEditor';
import type { ChordSelectionPending, TabMeasure, TabEditorHandle } from './TabEditor';
import { genSectionBody, genChordDefs, genTmdHeader } from './TabEditor';
import {
  getSegmentsByProject, getOrphanSegments,
  saveSegment, deleteSegment,
  type SegmentRecord,
} from '../../db/segment-repo';
import type { RhythmPattern } from '../../core/types';

export interface TabWorkspaceHandle {
  /** 外部触发保存（如 Ctrl+S） */
  save: () => void;
  /** 更新所有同名和弦的 positionIndex */
  updateChordPosition: (chordName: string, positionIndex: number) => void;
  /** 应用节奏型到当前段落 */
  applyRhythm: (rhythm: RhythmPattern) => void;
}

interface TabWorkspaceProps {
  projectId: string | null;
  onTmdChange?: (tmd: string) => void;
  onSegmentSaved?: () => void;
  onChordSelectionStart?: (sel: ChordSelectionPending) => void;
  chordToApply?: { name: string; positionIndex: number } | null;
  onChordApplied?: () => void;
  onChordClick?: (chordName: string, positionIndex?: number) => void;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  onRhythmSelectionStart?: () => void;
}

const SEG_KEY = 'tab-workspace-segment';

export const TabWorkspace = forwardRef<TabWorkspaceHandle, TabWorkspaceProps>(function TabWorkspace({
  projectId,
  onTmdChange, onSegmentSaved, onChordSelectionStart, chordToApply,
  onChordApplied, onChordClick, previewOpen, onTogglePreview, onRhythmSelectionStart,
}, ref) {
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [activeSegId, setActiveSegId] = useState<string | null>(() => {
    try { return localStorage.getItem(SEG_KEY) || null; } catch { return null; }
  });
  const [segmentName, setSegmentName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tabEditorRef = useRef<TabEditorHandle>(null);

  // 暴露 save 给外部（App 层 Ctrl+S）
  useImperativeHandle(ref, () => ({
    save() { tabEditorRef.current?.triggerSave(); },
    updateChordPosition(chordName: string, positionIndex: number) {
      tabEditorRef.current?.updateChordPosition(chordName, positionIndex);
    },
    applyRhythm(rhythm: RhythmPattern) {
      tabEditorRef.current?.applyRhythm(rhythm);
    },
  }), []);

  const [editorTempo, setEditorTempo] = useState(72);
  const [editorBpm, setEditorBpm] = useState(8);
  const [editorTsLabel, setEditorTsLabel] = useState('4/4');
  const [editorMeasures, setEditorMeasures] = useState<TabMeasure[] | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  // 当前编辑器实时 measures + 段落名
  const currentMeasuresRef = useRef<{ measures: TabMeasure[]; name: string } | null>(null);
  const rebuildRef = useRef<() => void>(() => {});

  // 编辑器 measures 变化 → 存起来，触发全量拼接
  const handleMeasuresChange = useCallback((measures: TabMeasure[], name: string) => {
    currentMeasuresRef.current = { measures, name };
    rebuildRef.current();
  }, []);

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
        setEditorTempo(seg.tempo);
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
      setEditorTempo(seg.tempo);
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
    setEditorTempo(72);
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

  // 空内容覆盖确认 dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingSaveRef = useRef<{ measures: TabMeasure[]; tempo: number; bpm: number; tsLabel: string } | null>(null);

  /**
   * 把项目下所有 segment 拼成一份完整 TMD
   * 已保存段落用 DB 数据，当前活跃段落用编辑器实时 measures
   */
  const rebuildFullTmd = useCallback(() => {
    const allChordRegions: import('./TabEditor').ChordRegion[] = [];
    const seenChords = new Set<string>();
    const bodies: string[] = [];
    let headerTempo = 72;
    let headerTs = '4/4';

    for (const seg of segments) {
      // 活跃段落用实时 measures
      if (seg.id === activeSegId && currentMeasuresRef.current) {
        const { measures: liveMeasures, name } = currentMeasuresRef.current;
        const { body, usedChords } = genSectionBody(liveMeasures, name || seg.name);
        if (body) {
          bodies.push(body);
          for (const c of usedChords) {
            if (!seenChords.has(c.name)) { seenChords.add(c.name); allChordRegions.push(c); }
          }
        }
        headerTempo = seg.tempo; headerTs = seg.tsLabel;
        continue;
      }
      try {
        const measures = JSON.parse(seg.measuresJson) as TabMeasure[];
        const { body, usedChords } = genSectionBody(measures, seg.name);
        if (body) {
          bodies.push(body);
          for (const c of usedChords) {
            if (!seenChords.has(c.name)) { seenChords.add(c.name); allChordRegions.push(c); }
          }
        }
      } catch (e) {
        console.warn(`段落 ${seg.name} 解析失败:`, e);
      }
      if (bodies.length === 1) { headerTempo = seg.tempo; headerTs = seg.tsLabel; }
    }

    // 新段落（未保存，activeSegId 为 null）
    if (!activeSegId && currentMeasuresRef.current) {
      const { measures: liveMeasures, name } = currentMeasuresRef.current;
      const { body, usedChords } = genSectionBody(liveMeasures, name || '新段落');
      if (body) {
        bodies.push(body);
        for (const c of usedChords) {
          if (!seenChords.has(c.name)) { seenChords.add(c.name); allChordRegions.push(c); }
        }
      }
    }

    if (bodies.length === 0) { onTmdChange?.(''); return; }

    const chordDefs = genChordDefs(allChordRegions);
    const header = genTmdHeader(headerTempo, headerTs, chordDefs);
    const fullTmd = `${header}\n\n${bodies.join('\n\n')}\n`;
    onTmdChange?.(fullTmd);
  }, [segments, activeSegId, onTmdChange]);

  // 保持 ref 同步
  rebuildRef.current = rebuildFullTmd;

  // 段落列表变化时重新拼接完整 TMD
  useEffect(() => {
    if (segments.length > 0) rebuildFullTmd();
  }, [segments, rebuildFullTmd]);

  const doSave = useCallback(async (measures: TabMeasure[], tempo: number, bpm: number, tsLabel: string) => {
    const name = segmentName.trim() || '未命名段落';
    setSaving(true);
    try {
      const rec = await saveSegment({
        id: activeSegId ?? undefined,
        name,
        projectId,
        tempo,
        bpm,
        tsLabel,
        measuresJson: JSON.stringify(measures),
      });
      setActiveSegId(rec.id);
      setSegmentName(rec.name);
      showSaveMsg(`已保存「${rec.name}」`);
      const latest = await refreshSegments();
      rebuildFullTmd();
      onSegmentSaved?.();
    } catch (e) {
      console.error('保存段落失败:', e);
      showSaveMsg('保存失败');
    } finally {
      setSaving(false);
    }
  }, [segmentName, activeSegId, projectId, showSaveMsg, refreshSegments]);

  const handleSave = useCallback(async (measures: TabMeasure[], tempo: number, bpm: number, tsLabel: string) => {
    const hasAnyContent = measures.some(m =>
      m.chords.length > 0 ||
      m.beats.some(b => b.rest || b.strings.some(s => s.type !== 'none'))
    );
    if (!hasAnyContent && activeSegId) {
      pendingSaveRef.current = { measures, tempo, bpm, tsLabel };
      setConfirmOpen(true);
      return;
    }
    await doSave(measures, tempo, bpm, tsLabel);
  }, [activeSegId, doSave]);

  const handleConfirmSave = useCallback(() => {
    setConfirmOpen(false);
    if (pendingSaveRef.current) {
      const { measures, tempo, bpm, tsLabel } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      doSave(measures, tempo, bpm, tsLabel);
    }
  }, [doSave]);

  return (
    <div className="tab-workspace">
      <SegmentNav
        segments={segments}
        activeSegmentId={activeSegId}
        isNewSegment={!activeSegId}
        onSelectSegment={handleSelectSegment}
        onNewSegment={handleNewSegment}
        onDeleteSegment={handleDeleteSegment}
      />
      <div className="tab-workspace-main">
        <TabEditor
          ref={tabEditorRef}
          key={editorKey}
          initialMeasures={editorMeasures}
          initialTempo={editorTempo}
          initialBpm={editorBpm}
          initialTsLabel={editorTsLabel}
          segmentName={segmentName}
          onSegmentNameChange={setSegmentName}
          onSave={handleSave}
          saving={saving}
          saveMsg={saveMsg}
          onMeasuresChange={handleMeasuresChange}
          onChordSelectionStart={onChordSelectionStart}
          chordToApply={chordToApply}
          onChordApplied={onChordApplied}
          onChordClick={onChordClick}
          previewOpen={previewOpen}
          onTogglePreview={onTogglePreview}
          onRhythmSelectionStart={onRhythmSelectionStart}
        />
      </div>

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="radix-dialog-overlay" />
          <AlertDialog.Content className="radix-dialog-content" style={{ maxWidth: 400 }}>
            <AlertDialog.Title className="radix-dialog-title">确认覆盖</AlertDialog.Title>
            <AlertDialog.Description className="radix-dialog-desc">
              当前段落内容为空，确定要覆盖已保存的数据吗？
            </AlertDialog.Description>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <AlertDialog.Cancel className="radix-dialog-btn">取消</AlertDialog.Cancel>
              <AlertDialog.Action className="radix-dialog-btn radix-dialog-btn--danger" onClick={handleConfirmSave}>
                确认覆盖
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
});
