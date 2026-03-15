/**
 * 全局应用状态
 *
 * 管理: TMD 源码、管线结果、播放状态、侧边栏、当前吉他谱 ID、DB 状态
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { tmdToAlphaTex, type PipelineResult } from '../../core/pipeline';
import { saveScore, deleteScore, getVersionById } from '../../db/score-repo';
import { bulkUpsertRhythms } from '../../db/rhythm-repo';
import { initDatabase } from '../../db/init';

export type PlaybackState = 'stopped' | 'playing' | 'paused';
export type SidebarTab = 'chords' | 'rhythms' | 'scores' | null;

export function useAppState(initialTmd: string) {
  const [tmdSource, setTmdSourceRaw] = useState(initialTmd);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(null);
  const [currentScoreId, setCurrentScoreId] = useState<string | null>(null);
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

  const runPipeline = useCallback((source: string) => {
    const result = tmdToAlphaTex(source);
    setPipelineResult(result);

    // 异步同步节奏型到 DB
    if (result.song) {
      const rhythms = Array.from(result.song.rhythmLibrary.values());
      if (rhythms.length > 0) {
        bulkUpsertRhythms(rhythms, 'score').catch(console.error);
      }
    }
    return result;
  }, []);

  // 首次渲染
  useEffect(() => {
    runPipeline(initialTmd);
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

  // 保存
  const handleSave = useCallback(async () => {
    if (!pipelineResult?.song) return;
    setIsSaving(true);
    try {
      const result = await saveScore({
        scoreId: currentScoreId ?? undefined,
        tmdSource,
        song: pipelineResult.song,
        description: '手动保存',
      });
      setCurrentScoreId(result.scoreId);
      setCurrentVersionId(result.versionId);
      showSaveMessage(`已保存 v${result.version}`);
    } catch (e) {
      console.error('保存失败:', e);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [pipelineResult, tmdSource, currentScoreId, showSaveMessage]);

  // 加载某个版本
  const loadVersion = useCallback(async (versionId: string) => {
    try {
      const ver = await getVersionById(versionId);
      if (ver) {
        setCurrentScoreId(ver.scoreId);
        setCurrentVersionId(ver.id);
        setTmdSourceRaw(ver.tmdSource);
        runPipeline(ver.tmdSource);
      }
    } catch (e) {
      console.error('加载版本失败:', e);
    }
  }, [runPipeline]);

  // 删除吉他谱
  const handleDeleteScore = useCallback(async (scoreId: string) => {
    try {
      await deleteScore(scoreId);
      if (currentScoreId === scoreId) {
        setCurrentScoreId(null);
        setCurrentVersionId(null);
      }
    } catch (e) {
      console.error('删除失败:', e);
    }
  }, [currentScoreId]);

  const toggleSidebar = useCallback((tab: SidebarTab) => {
    setSidebarTab(prev => prev === tab ? null : tab);
  }, []);

  return {
    tmdSource,
    pipelineResult,
    playbackState,
    sidebarTab,
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
    handleSave,
    handleDeleteScore,
    loadVersion,
  };
}
