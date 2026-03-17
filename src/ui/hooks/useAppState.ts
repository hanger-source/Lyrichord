/**
 * 全局应用状态
 *
 * 管理: 当前项目、TMD 源码、管线结果、播放状态、侧边栏、DB 状态
 *
 * 项目（Score）是全局概念：
 *   - TMD 模式编辑的是项目的 TMD 源码（score_versions）
 *   - TAB 模式编辑的是项目的段落（tab_segments）
 *   - 切换项目 → 两个模式同时切换上下文
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { tmdToAlphaTex, expandSegmentRefs, type PipelineResult } from '../../core/pipeline';
import { saveScore, deleteScore, getVersionById, getLatestVersion, getAllScores, type ScoreRecord } from '../../db/score-repo';
import { getAllSegments, type SegmentRecord } from '../../db/segment-repo';
import { genSectionBody } from '../components/TabEditor';
import type { TabMeasure } from '../components/TabEditor';
import { bulkUpsertRhythms, getAllRhythms } from '../../db/rhythm-repo';
import { upsertChord, getAllChords } from '../../db/chord-repo';
import { getDb, persist } from '../../db/connection';
import { initDatabase } from '../../db/init';

export type PlaybackState = 'stopped' | 'playing' | 'paused';
export type SidebarTab = 'chords' | 'rhythms' | 'scores' | 'tabeditor' | null;

const PROJECT_KEY = 'lyrichord-active-project';

function loadSavedProject(): { id: string | null; title: string } {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.id) return parsed;
    }
  } catch {}
  return { id: null, title: '' };
}

export function useAppState() {
  const savedProject = useRef(loadSavedProject());
  const [tmdSource, setTmdSourceRaw] = useState('');
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => {
    try {
      const saved = localStorage.getItem('lyrichord-sidebar-tab');
      if (saved && ['chords', 'rhythms', 'scores', 'tabeditor'].includes(saved)) return saved as SidebarTab;
    } catch {}
    return null;
  });

  // ---- 全局项目状态 ----
  const [activeProjectId, setActiveProjectIdRaw] = useState<string | null>(savedProject.current.id);
  const [activeProjectTitle, setActiveProjectTitle] = useState(savedProject.current.title);
  const [projects, setProjects] = useState<ScoreRecord[]>([]);

  // 段落缓存 — 用于 @segment(Name) 引用展开
  const segmentCacheRef = useRef<SegmentRecord[]>([]);
  const [segmentNames, setSegmentNames] = useState<string[]>([]);
  const refreshSegmentCache = useCallback(async () => {
    try {
      const segs = await getAllSegments();
      segmentCacheRef.current = segs;
      setSegmentNames(segs.map(s => s.name));
    } catch {}
  }, []);

  // 和弦名 + 节奏型 ID 缓存 — 用于 TMD 编辑器智能提示
  const [chordNames, setChordNames] = useState<string[]>([]);
  const [rhythmIds, setRhythmIds] = useState<string[]>([]);
  const refreshCompletionData = useCallback(async () => {
    try {
      const [chords, rhythms] = await Promise.all([getAllChords(), getAllRhythms()]);
      setChordNames(chords.map(c => c.id));
      setRhythmIds(rhythms.map(r => r.id));
    } catch {}
  }, []);

  const [currentScoreId, setCurrentScoreId] = useState<string | null>(savedProject.current.id);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化数据库
  useEffect(() => {
    initDatabase()
      .then(info => {
        console.log(`DB 初始化完成，${info.chordCount} 个内置和弦`);
        setDbReady(true);
      })
      .catch(e => {
        console.error('DB 初始化失败:', e);
        setDbError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // 加载项目列表
  const refreshProjects = useCallback(async () => {
    try {
      const list = await getAllScores();
      setProjects(list);
      return list;
    } catch (e) {
      console.error('加载项目列表失败:', e);
      return [];
    }
  }, []);

  useEffect(() => {
    if (dbReady) {
      refreshProjects();
      refreshSegmentCache();
      refreshCompletionData();
    }
  }, [dbReady, refreshProjects, refreshSegmentCache, refreshCompletionData]);

  // 持久化项目选择
  useEffect(() => {
    try { localStorage.setItem(PROJECT_KEY, JSON.stringify({ id: activeProjectId, title: activeProjectTitle })); } catch {}
  }, [activeProjectId, activeProjectTitle]);

  const runPipeline = useCallback((source: string, opts?: { syncRhythms?: boolean }) => {
    // 展开 @segment(Name) 引用
    const expanded = expandSegmentRefs(source, (name) => {
      const seg = segmentCacheRef.current.find(s => s.name === name);
      if (!seg) {
        console.warn(`[Pipeline] @segment(${name}) 未找到。缓存: [${segmentCacheRef.current.map(s => s.name).join(', ')}]`);
        return null;
      }
      try {
        const measures = JSON.parse(seg.measuresJson) as TabMeasure[];
        const { body } = genSectionBody(measures, seg.name, seg.tsLabel);
        return body || null;
      } catch { return null; }
    });

    const result = tmdToAlphaTex(expanded);
    setPipelineResult(result);

    // 异步同步节奏型和自定义和弦到 DB，完成后刷新补全候选
    if (result.song) {
      const syncTasks: Promise<unknown>[] = [];
      // 只在明确要求时同步节奏型（避免旧项目 TMD 覆盖新定义）
      if (opts?.syncRhythms !== false) {
        const rhythms = Array.from(result.song.rhythmLibrary.values());
        if (rhythms.length > 0) {
          console.log('[Pipeline] 同步节奏型到 DB:', rhythms.map(r => `${r.id}(${r.slots.length} slots)`).join(', '));
          syncTasks.push(bulkUpsertRhythms(rhythms, 'score'));
        }
      }
      const customChords = Array.from(result.song.chordLibrary.values());
      if (customChords.length > 0) {
        syncTasks.push(Promise.all(customChords.map(c => upsertChord(c, 'user'))));
      }
      if (syncTasks.length > 0) {
        Promise.all(syncTasks)
          .then(() => refreshCompletionData())
          .catch(console.error);
      }
    }
    return result;
  }, [refreshCompletionData]);

  // 首次渲染
  useEffect(() => {
    runPipeline('');
  }, []);

  const setTmdSource = useCallback((source: string) => {
    setTmdSourceRaw(source);
    runPipeline(source);
  }, [runPipeline]);

  const showSaveMessage = useCallback((msg: string) => {
    setSaveMessage(msg);
    if (saveMessageTimer.current) clearTimeout(saveMessageTimer.current);
    saveMessageTimer.current = setTimeout(() => setSaveMessage(null), 3000);
  }, []);

  // 保存 — 关联到当前项目
  const handleSave = useCallback(async () => {
    if (!pipelineResult?.song) return;
    // 内容没变就不创建新版本
    if (activeProjectId) {
      try {
        const latest = await getLatestVersion(activeProjectId);
        if (latest && latest.tmdSource === tmdSource) {
          showSaveMessage('无变更');
          return;
        }
      } catch {}
    }
    setIsSaving(true);
    try {
      const result = await saveScore({
        scoreId: activeProjectId ?? undefined,
        tmdSource,
        song: pipelineResult.song,
        description: '手动保存',
      });
      // 保存后同步项目状态
      if (!activeProjectId) {
        setActiveProjectIdRaw(result.scoreId);
        setActiveProjectTitle(pipelineResult.song.meta.title ?? '未命名');
      }
      setCurrentScoreId(result.scoreId);
      setCurrentVersionId(result.versionId);
      showSaveMessage(`已保存 v${result.version}`);
      refreshProjects();
    } catch (e) {
      console.error('保存失败:', e);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [pipelineResult, tmdSource, activeProjectId, showSaveMessage, refreshProjects]);

  // 加载某个版本
  const loadVersion = useCallback(async (versionId: string) => {
    try {
      const ver = await getVersionById(versionId);
      if (ver) {
        setCurrentScoreId(ver.scoreId);
        setCurrentVersionId(ver.id);
        setTmdSourceRaw(ver.tmdSource);
        runPipeline(ver.tmdSource, { syncRhythms: false });
      }
    } catch (e) {
      console.error('加载版本失败:', e);
    }
  }, [runPipeline]);

  // 删除吉他谱
  const handleDeleteScore = useCallback(async (scoreId: string) => {
    try {
      await deleteScore(scoreId);
      const remaining = await refreshProjects();
      if (activeProjectId === scoreId) {
        // 切到剩余的第一个项目
        if (remaining.length > 0) {
          const next = remaining[0];
          setActiveProjectIdRaw(next.id);
          setActiveProjectTitle(next.title);
          setCurrentScoreId(next.id);
        } else {
          setActiveProjectIdRaw(null);
          setActiveProjectTitle('');
          setCurrentScoreId(null);
        }
        setCurrentVersionId(null);
      }
    } catch (e) {
      console.error('删除失败:', e);
    }
  }, [activeProjectId, refreshProjects]);

  // 切换项目 — 全局，TMD 和 TAB 都跟着切
  const switchProject = useCallback(async (projectId: string | null, title: string) => {
    setActiveProjectIdRaw(projectId);
    setActiveProjectTitle(title);
    setCurrentScoreId(projectId);
    setCurrentVersionId(null);

    // 加载该项目最新版本的 TMD
    if (projectId) {
      try {
        const ver = await getLatestVersion(projectId);
        if (ver) {
          setCurrentVersionId(ver.id);
          setTmdSourceRaw(ver.tmdSource);
          runPipeline(ver.tmdSource, { syncRhythms: false });
          return;
        }
      } catch (e) {
        console.error('加载项目版本失败:', e);
      }
    }
    // 无项目或无版本 → 清空
    setTmdSourceRaw('');
    runPipeline('');
  }, [runPipeline]);

  // 新建项目
  const createProject = useCallback(async (title: string) => {
    try {
      const db = await getDb();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.run('INSERT INTO scores (id, title) VALUES (?, ?)', [id, title]);
      await persist();
      await refreshProjects();
      // 自动切换到新项目
      setActiveProjectIdRaw(id);
      setActiveProjectTitle(title);
      setCurrentScoreId(id);
      setCurrentVersionId(null);
      return id;
    } catch (e) {
      console.error('创建项目失败:', e);
      return null;
    }
  }, [refreshProjects]);

  // DB 就绪后：加载活跃项目数据
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!dbReady || initialLoadDone.current) return;
    initialLoadDone.current = true;

    (async () => {
      const allProjects = await refreshProjects();

      // 如果有保存的项目 ID，直接用
      if (activeProjectId) {
        const exists = allProjects.find(p => p.id === activeProjectId);
        if (exists) {
          setActiveProjectTitle(exists.title);
          const ver = await getLatestVersion(activeProjectId);
          if (ver) {
            setCurrentVersionId(ver.id);
            setTmdSourceRaw(ver.tmdSource);
            runPipeline(ver.tmdSource, { syncRhythms: false });
          }
          return;
        }
      }

      // 没有保存的项目 → 用第一个
      if (allProjects.length > 0) {
        const first = allProjects[0];
        setActiveProjectIdRaw(first.id);
        setActiveProjectTitle(first.title);
        setCurrentScoreId(first.id);
        const ver = await getLatestVersion(first.id);
        if (ver) {
          setCurrentVersionId(ver.id);
          setTmdSourceRaw(ver.tmdSource);
          runPipeline(ver.tmdSource, { syncRhythms: false });
        }
      }
    })().catch(console.error);
  }, [dbReady, activeProjectId, runPipeline, refreshProjects]);

  const toggleSidebar = useCallback((tab: SidebarTab) => {
    setSidebarTab(prev => {
      const next = prev === tab ? null : tab;
      try { localStorage.setItem('lyrichord-sidebar-tab', next ?? ''); } catch {}
      return next;
    });
  }, []);

  return {
    tmdSource,
    pipelineResult,
    playbackState,
    sidebarTab,
    // 全局项目
    activeProjectId,
    activeProjectTitle,
    projects,
    switchProject,
    createProject,
    refreshProjects,
    // 版本
    currentScoreId,
    currentVersionId,
    isSaving,
    dbReady,
    dbError,
    saveMessage,
    setTmdSource,
    setPlaybackState,
    setSidebarTab: toggleSidebar,
    setCurrentScoreId,
    setCurrentVersionId,
    runPipeline,
    refreshSegmentCache,
    segmentNames,
    chordNames,
    rhythmIds,
    handleSave,
    handleDeleteScore,
    loadVersion,
  };
}
