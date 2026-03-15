/**
 * 侧边栏 — 和弦库 / 节奏型库 / 吉他谱库
 *
 * 三个面板各自独立管理状态，通过 tab 切换。
 */
import { useState, useEffect, useCallback } from 'react';
import type { SidebarTab } from '../hooks/useAppState';
import type { Song, ChordDefinition, RhythmPattern, RhythmSlot } from '../../core/types';
import { renderChordDiagram } from '../chord-diagram';
import { resolveChord } from '../../core/chord/resolver';
import { getAllChords, searchChords, getChordUsageCount } from '../../db/chord-repo';
import {
  getAllScores, getScoreWithVersions, getLatestVersion,
  type ScoreRecord, type ScoreWithVersions,
} from '../../db/score-repo';

interface SidebarProps {
  tab: SidebarTab;
  song: Song | null;
  currentScoreId: string | null;
  onSelectScore: (id: string, tmd: string) => void;
  onDeleteScore: (id: string) => Promise<void>;
  onLoadVersion: (versionId: string) => Promise<void>;
}

export function Sidebar({ tab, song, currentScoreId, onSelectScore, onDeleteScore, onLoadVersion }: SidebarProps) {
  return (
    <aside className="sidebar">
      {tab === 'chords' && <ChordPanel song={song} />}
      {tab === 'rhythms' && <RhythmPanel song={song} />}
      {tab === 'scores' && (
        <ScorePanel
          currentScoreId={currentScoreId}
          onSelectScore={onSelectScore}
          onDeleteScore={onDeleteScore}
          onLoadVersion={onLoadVersion}
        />
      )}
    </aside>
  );
}

// ============================================================
//  和弦面板
// ============================================================

function ChordPanel({ song }: { song: Song | null }) {
  const [viewMode, setViewMode] = useState<'current' | 'library'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryChords, setLibraryChords] = useState<ChordDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  const currentChordIds = song ? collectChordIds(song) : [];

  // 加载全局和弦库
  useEffect(() => {
    if (viewMode === 'library') {
      loadLibrary();
    }
  }, [viewMode, searchQuery]);

  async function loadLibrary() {
    setLoading(true);
    try {
      const chords = searchQuery.trim()
        ? await searchChords(searchQuery.trim())
        : await getAllChords();
      setLibraryChords(chords);
    } catch (e) {
      console.error('加载和弦库失败:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <h3 className="panel-title">🎵 和弦</h3>
        <div className="panel-tabs">
          <button
            className={`panel-tab ${viewMode === 'current' ? 'panel-tab--active' : ''}`}
            onClick={() => setViewMode('current')}
          >
            当前曲目
          </button>
          <button
            className={`panel-tab ${viewMode === 'library' ? 'panel-tab--active' : ''}`}
            onClick={() => setViewMode('library')}
          >
            全部
          </button>
        </div>
      </div>

      {viewMode === 'library' && (
        <input
          className="panel-search"
          type="text"
          placeholder="搜索和弦 (如 Am7, D/F#)..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      )}

      {viewMode === 'current' ? (
        currentChordIds.length === 0 ? (
          <p className="panel-empty">当前曲目暂无和弦</p>
        ) : (
          <div className="chord-grid">
            {currentChordIds.map(id => (
              <ChordCard key={id} chordId={id} />
            ))}
          </div>
        )
      ) : loading ? (
        <p className="panel-empty">加载中...</p>
      ) : libraryChords.length === 0 ? (
        <p className="panel-empty">
          {searchQuery ? '未找到匹配的和弦' : '和弦库为空'}
        </p>
      ) : (
        <div className="chord-grid">
          {libraryChords.map(chord => (
            <ChordCardDef key={chord.id} chord={chord} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChordCard({ chordId }: { chordId: string }) {
  const chord = resolveChord(chordId);
  if (!chord) {
    return (
      <div className="chord-card chord-card--unknown">
        <span className="chord-name">{chordId}</span>
        <span className="chord-hint">未知和弦</span>
      </div>
    );
  }
  return (
    <div className="chord-card">
      <div
        className="chord-svg"
        dangerouslySetInnerHTML={{ __html: renderChordDiagram(chord) }}
      />
    </div>
  );
}

function ChordCardDef({ chord }: { chord: ChordDefinition }) {
  return (
    <div className="chord-card">
      <div
        className="chord-svg"
        dangerouslySetInnerHTML={{ __html: renderChordDiagram(chord) }}
      />
    </div>
  );
}

// ============================================================
//  节奏型面板
// ============================================================

function RhythmPanel({ song }: { song: Song | null }) {
  const rhythms = song ? Array.from(song.rhythmLibrary.values()) : [];

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <h3 className="panel-title">🥁 节奏型</h3>
        <span className="panel-count">{rhythms.length} 个</span>
      </div>
      {rhythms.length === 0 ? (
        <p className="panel-empty">当前曲目暂无节奏型定义</p>
      ) : (
        <div className="rhythm-list">
          {rhythms.map(r => (
            <RhythmCard key={r.id} rhythm={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RhythmCard({ rhythm }: { rhythm: RhythmPattern }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rhythm-card" onClick={() => setExpanded(!expanded)}>
      <div className="rhythm-header">
        <span className="rhythm-id">@{rhythm.id}</span>
        <span className={`rhythm-badge rhythm-badge--${rhythm.type}`}>
          {rhythm.type === 'strum' ? '扫弦' : '拨弦'}
        </span>
      </div>
      <div className="rhythm-slots-row">
        {rhythm.slots.map((slot, i) => (
          <span key={i} className={`slot slot--${slot.kind}`}>
            {slotLabel(slot)}
          </span>
        ))}
      </div>
      {expanded && (
        <div className="rhythm-detail">
          <code className="rhythm-raw">{rhythm.raw}</code>
          {rhythm.speed && rhythm.speed !== 1 && (
            <span className="rhythm-speed">速度: {rhythm.speed}x</span>
          )}
        </div>
      )}
    </div>
  );
}

function slotLabel(slot: RhythmSlot): string {
  if (slot.kind === 'pluck') {
    return slot.target === 'root' ? 'R' : slot.strings.join('');
  }
  switch (slot.action) {
    case 'down': return '↓';
    case 'up': return '↑';
    case 'mute': return 'X';
    case 'sustain': return '—';
    default: return '?';
  }
}

// ============================================================
//  吉他谱面板
// ============================================================

function ScorePanel({ currentScoreId, onSelectScore, onDeleteScore, onLoadVersion }: {
  currentScoreId: string | null;
  onSelectScore: (id: string, tmd: string) => void;
  onDeleteScore: (id: string) => Promise<void>;
  onLoadVersion: (versionId: string) => Promise<void>;
}) {
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ScoreWithVersions | null>(null);

  useEffect(() => { loadScores(); }, []);

  async function loadScores() {
    setLoading(true);
    try {
      setScores(await getAllScores());
    } catch (e) {
      console.error('加载谱库失败:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(score: ScoreRecord) {
    try {
      const version = await getLatestVersion(score.id);
      if (version) onSelectScore(score.id, version.tmdSource);
    } catch (e) {
      console.error('加载吉他谱失败:', e);
    }
  }

  async function handleExpand(scoreId: string) {
    if (expandedId === scoreId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    try {
      const detail = await getScoreWithVersions(scoreId);
      setExpandedId(scoreId);
      setExpandedDetail(detail);
    } catch (e) {
      console.error('加载版本失败:', e);
    }
  }

  async function handleDelete(scoreId: string) {
    await onDeleteScore(scoreId);
    setScores(prev => prev.filter(s => s.id !== scoreId));
    if (expandedId === scoreId) {
      setExpandedId(null);
      setExpandedDetail(null);
    }
  }

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <h3 className="panel-title">📚 吉他谱库</h3>
        <button className="btn-tiny" onClick={loadScores} title="刷新">🔄</button>
      </div>

      {loading ? (
        <p className="panel-empty">加载中...</p>
      ) : scores.length === 0 ? (
        <p className="panel-empty">暂无保存的吉他谱<br/>编辑后点击「保存」按钮</p>
      ) : (
        <div className="score-list">
          {scores.map(s => (
            <div key={s.id} className={`score-item ${currentScoreId === s.id ? 'score-item--active' : ''}`}>
              <div className="score-item-main" onClick={() => handleSelect(s)}>
                <span className="score-title">{s.title}</span>
                {s.artist && <span className="score-artist">{s.artist}</span>}
              </div>
              <div className="score-item-actions">
                <button
                  className="btn-tiny"
                  onClick={(e) => { e.stopPropagation(); handleExpand(s.id); }}
                  title="版本历史"
                >
                  {expandedId === s.id ? '▾' : '▸'}
                </button>
                <button
                  className="btn-tiny btn-tiny--danger"
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                  title="删除"
                >
                  🗑
                </button>
              </div>

              {expandedId === s.id && expandedDetail && (
                <div className="version-list">
                  {expandedDetail.versions.map(v => (
                    <div
                      key={v.id}
                      className="version-item"
                      onClick={(e) => { e.stopPropagation(); onLoadVersion(v.id); }}
                    >
                      <span className="version-num">v{v.version}</span>
                      <span className="version-meta">
                        {v.tempo}bpm · {v.timeSigN}/{v.timeSigD}
                        {v.capo > 0 && ` · capo ${v.capo}`}
                      </span>
                      <span className="version-date">{v.createdAt?.slice(0, 16)}</span>
                      {v.description && <span className="version-desc">{v.description}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  工具函数
// ============================================================

function collectChordIds(song: Song): string[] {
  const set = new Set<string>();
  for (const bar of song.bars) {
    for (const beat of bar.beats) {
      if (beat.chordId) set.add(beat.chordId);
    }
  }
  return Array.from(set);
}
