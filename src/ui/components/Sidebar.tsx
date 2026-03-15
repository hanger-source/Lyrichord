/**
 * 侧边栏 — 和弦库 / 节奏型库 / 吉他谱库
 *
 * 使用 Radix UI 组件: Tabs, Tooltip, ScrollArea
 */
import { useState, useEffect, useRef, memo } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import {
  Music, Drum, RefreshCw, Trash2, BookOpen,
  ChevronDown, ChevronRight, Search,
} from 'lucide-react';
import type { SidebarTab } from '../hooks/useAppState';
import type { Song, ChordDefinition, RhythmPattern, RhythmSlot } from '../../core/types';import { renderChordDiagram } from '../chord-diagram';
import { resolveChord } from '../../core/chord/resolver';
import { getAllChordDefs, searchChordsInDB } from '../../core/chord/database';
import { getChordsBySource } from '../../db/chord-repo';
import {
  getAllScores, getScoreWithVersions, getLatestVersion,
  type ScoreRecord, type ScoreWithVersions,
} from '../../db/score-repo';

const ROOT_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

interface SidebarProps {
  tab: SidebarTab;
  song: Song | null;
  currentScoreId: string | null;
  onSelectScore: (id: string, tmd: string) => void;
  onDeleteScore: (id: string) => Promise<void>;
  onLoadVersion: (versionId: string) => Promise<void>;
  /** TAB 模式下，点击和弦卡片选择和弦 */
  onChordPick?: (chordName: string) => void;
  /** 从 TAB 编辑器点击和弦 → 高亮对应卡片 */
  highlightChord?: string | null;
  onHighlightClear?: () => void;
}

export const Sidebar = memo(function Sidebar({ tab, song, currentScoreId, onSelectScore, onDeleteScore, onLoadVersion, onChordPick, highlightChord, onHighlightClear }: SidebarProps) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="sidebar">
        <div style={{ display: tab === 'chords' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ChordPanel song={song} onChordPick={onChordPick} highlightChord={highlightChord} onHighlightClear={onHighlightClear} />
        </div>
        <div style={{ display: tab === 'rhythms' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea.Root className="sidebar-scroll-root">
            <ScrollArea.Viewport className="sidebar-scroll-viewport">
              <RhythmPanel song={song} />
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="sidebar-scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="sidebar-scrollbar-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </div>
        <div style={{ display: tab === 'scores' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea.Root className="sidebar-scroll-root">
            <ScrollArea.Viewport className="sidebar-scroll-viewport">
              <ScorePanel
                currentScoreId={currentScoreId}
                onSelectScore={onSelectScore}
                onDeleteScore={onDeleteScore}
                onLoadVersion={onLoadVersion}
              />
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar className="sidebar-scrollbar" orientation="vertical">
              <ScrollArea.Thumb className="sidebar-scrollbar-thumb" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </div>
      </aside>
    </Tooltip.Provider>
  );
});


// ============================================================
//  和弦面板 — 按根音分组
// ============================================================

function groupByRoot(chords: ChordDefinition[]): Map<string, ChordDefinition[]> {
  const groups = new Map<string, ChordDefinition[]>();
  for (const chord of chords) {
    const root = chord.key || extractRoot(chord.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(chord);
  }
  return groups;
}

function extractRoot(id: string): string {
  const m = id.match(/^([A-G][#b]?)/);
  return m ? m[1] : '?';
}

const ChordPanel = memo(function ChordPanel({ song, onChordPick, highlightChord, onHighlightClear }: { song: Song | null; onChordPick?: (name: string) => void; highlightChord?: string | null; onHighlightClear?: () => void }) {
  const [viewMode, setViewMode] = useState<'current' | 'library'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryChords, setLibraryChords] = useState<ChordDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const currentChordIds = song ? collectChordIds(song) : [];

  // 高亮和弦 → 自动切到全部库、跳转根音
  useEffect(() => {
    if (!highlightChord) return;
    setViewMode('library');
    setFilterType('all');
    setSearchQuery('');
    scrollToRoot(extractRoot(highlightChord));
  }, [highlightChord]);

  useEffect(() => {
    if (viewMode === 'library') loadLibrary();
  }, [viewMode, searchQuery, sourceFilter]);

  async function loadLibrary() {
    setLoading(true);
    try {
      let chords: ChordDefinition[];
      if (searchQuery.trim()) {
        chords = searchChordsInDB(searchQuery.trim());
        if (sourceFilter === 'custom') {
          const customIds = new Set((await getChordsBySource('user')).map(c => c.id));
          chords = chords.filter(c => customIds.has(c.id));
        }
      } else if (sourceFilter === 'custom') {
        chords = await getChordsBySource('user');
      } else {
        chords = getAllChordDefs();
      }
      setLibraryChords(chords);
    } catch (e) {
      console.error('加载和弦库失败:', e);
    } finally {
      setLoading(false);
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToRoot(root: string) {
    setActiveRoot(root);
    requestAnimationFrame(() => {
      const el = groupRefs.current.get(root);
      const container = scrollRef.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        container.scrollTop += elRect.top - containerRect.top;
      }
    });
  }

  const chordList: ChordDefinition[] = viewMode === 'current'
    ? currentChordIds.map(id => resolveChord(id)).filter((c): c is ChordDefinition => !!c)
    : libraryChords;

  const filtered = filterType === 'all' ? chordList : chordList.filter(c => {
    const suffix = c.suffix || '';
    switch (filterType) {
      case 'major': return suffix === 'major' || suffix === '';
      case 'minor': return suffix === 'minor' || suffix.startsWith('m') && !suffix.startsWith('maj');
      case '7th': return suffix.includes('7');
      case 'other': return !['major', '', 'minor'].includes(suffix) && !suffix.includes('7') && !suffix.startsWith('m');
      default: return true;
    }
  });

  const grouped = groupByRoot(filtered);

  return (
    <div className="sidebar-panel chord-panel-layout">
      {/* 固定头部 */}
      <div className="chord-panel-fixed">
        <div className="panel-header">
          <h3 className="panel-title"><Music size={14} /> 和弦</h3>
          <div className="panel-tabs">
            <button
              className={`panel-tab ${viewMode === 'current' ? 'panel-tab--active' : ''}`}
              onClick={() => setViewMode('current')}
            >当前</button>
            <button
              className={`panel-tab ${viewMode === 'library' ? 'panel-tab--active' : ''}`}
              onClick={() => setViewMode('library')}
            >全部</button>
          </div>
        </div>

        <div className="chord-filters">
          <div className="search-input-wrap">
            <Search size={13} className="search-icon" />
            <input
              className="panel-search"
              type="text"
              placeholder="搜索和弦..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filter-chips">
            {[
              { key: 'all', label: '全部' },
              { key: 'major', label: '大调' },
              { key: 'minor', label: '小调' },
              { key: '7th', label: '七和弦' },
              { key: 'other', label: '其他' },
            ].map(f => (
              <button
                key={f.key}
                className={`filter-chip ${filterType === f.key ? 'filter-chip--active' : ''}`}
                onClick={() => setFilterType(f.key)}
              >{f.label}</button>
            ))}
          </div>
          {viewMode === 'library' && (
            <div className="filter-chips filter-chips--source">
              {([['all', '全部来源'], ['builtin', '标准库'], ['custom', '自定义']] as const).map(([k, l]) => (
                <button
                  key={k}
                  className={`filter-chip ${sourceFilter === k ? 'filter-chip--active' : ''}`}
                  onClick={() => setSourceFilter(k)}
                >{l}</button>
              ))}
            </div>
          )}
        </div>

        {viewMode === 'library' && !searchQuery && (
          <div className="root-nav">
            {ROOT_KEYS.map(key => {
              const hasChords = grouped.has(key);
              return (
                <button
                  key={key}
                  className={`root-nav-btn ${activeRoot === key ? 'root-nav-btn--active' : ''} ${!hasChords ? 'root-nav-btn--empty' : ''}`}
                  onClick={() => hasChords && scrollToRoot(key)}
                  disabled={!hasChords}
                >{key}</button>
              );
            })}
          </div>
        )}
      </div>

      {/* 可滚动内容 */}
      <div className="chord-panel-scroll" ref={scrollRef}>
      {loading ? (
        <p className="panel-empty">加载中...</p>
      ) : filtered.length === 0 ? (
        <p className="panel-empty">
          {searchQuery ? '未找到匹配的和弦' : viewMode === 'current' ? '当前曲目暂无和弦' : '和弦库为空'}
        </p>
      ) : (
        <div className="chord-groups">
          {ROOT_KEYS.filter(key => grouped.has(key)).map(key => {
            const chords = grouped.get(key)!;
            return (
              <div key={key} className="chord-group"
                ref={el => { if (el) groupRefs.current.set(key, el); }}
              >
                <div className="chord-group-header chord-group-header--static">
                  <span className="chord-group-key">{key}</span>
                  <span className="chord-group-count">{chords.length}</span>
                </div>
                <div className="chord-group-grid">
                  {chords.map(chord => (
                    <ChordCardDef key={chord.id} chord={chord} onPick={onChordPick}
                      highlight={highlightChord === chord.id}
                      onHighlightClear={onHighlightClear}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>{/* chord-panel-scroll end */}
    </div>
  );
});

function ChordCardDef({ chord, onPick, highlight, onHighlightClear }: { chord: ChordDefinition; onPick?: (name: string) => void; highlight?: boolean; onHighlightClear?: () => void }) {
  const [selectedPos, setSelectedPos] = useState(0);
  const variantCount = chord.positions?.length ?? 0;
  const cardRef = useRef<HTMLDivElement>(null);

  // 高亮时滚动到可见区域
  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
      // 3秒后清除高亮
      const t = setTimeout(() => onHighlightClear?.(), 3000);
      return () => clearTimeout(t);
    }
  }, [highlight, onHighlightClear]);

  const displayChord = variantCount > 1
    ? { ...chord, selectedPosition: selectedPos }
    : chord;

  function cycleVariant(e: React.MouseEvent) {
    e.stopPropagation();
    if (variantCount > 1) {
      setSelectedPos(prev => (prev + 1) % variantCount);
    }
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div
          ref={cardRef}
          className={`chord-card ${onPick ? 'chord-card--pickable' : ''} ${highlight ? 'chord-card--highlight' : ''}`}
          onClick={onPick ? () => onPick(chord.id) : undefined}
        >
          <div
            className="chord-svg"
            dangerouslySetInnerHTML={{ __html: renderChordDiagram(displayChord) }}
          />
          {variantCount > 1 && (
            <button
              className="chord-variants-badge"
              title={`指法 ${selectedPos + 1}/${variantCount}`}
              onClick={cycleVariant}
            >
              {selectedPos + 1}/{variantCount}
            </button>
          )}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="radix-tooltip" sideOffset={5}>
          <span className="tooltip-chord-name">{chord.displayName}</span>
          {chord.suffix && chord.suffix !== 'major' && (
            <span className="tooltip-chord-suffix">{chord.suffix}</span>
          )}
          {variantCount > 1 && (
            <span className="tooltip-chord-hint">点击切换指法</span>
          )}
          <Tooltip.Arrow className="radix-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}


// ============================================================
//  节奏型面板
// ============================================================

const RhythmPanel = memo(function RhythmPanel({ song }: { song: Song | null }) {
  const rhythms = song ? Array.from(song.rhythmLibrary.values()) : [];

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <h3 className="panel-title"><Drum size={14} /> 节奏型</h3>
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
});

function RhythmCard({ rhythm }: { rhythm: RhythmPattern }) {
  const [expanded, setExpanded] = useState(false);
  const slotsPerBeat = rhythm.slots.length >= 8 ? Math.ceil(rhythm.slots.length / 4) : Math.ceil(rhythm.slots.length / 2);

  return (
    <div className="rhythm-card" onClick={() => setExpanded(!expanded)}>
      <div className="rhythm-header">
        <span className="rhythm-id">@{rhythm.id}</span>
        <div className="rhythm-header-right">
          <span className="rhythm-slot-count">{rhythm.slots.length} 拍位</span>
          <span className={`rhythm-badge rhythm-badge--${rhythm.type}`}>
            {rhythm.type === 'strum' ? '扫弦' : '拨弦'}
          </span>
        </div>
      </div>

      {/* 可视化节奏图 */}
      <div className="rhythm-visual">
        {rhythm.slots.map((slot, i) => {
          const isBeatBoundary = i > 0 && i % slotsPerBeat === 0;
          return (
            <div key={i} className="rhythm-visual-group">
              {isBeatBoundary && <div className="rhythm-beat-divider" />}
              <div className={`rhythm-cell rhythm-cell--${slot.kind} ${getCellModifier(slot)}`}>
                <span className="rhythm-cell-icon">{getSlotIcon(slot)}</span>
                <span className="rhythm-cell-label">{getSlotLabel(slot)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {expanded && (
        <div className="rhythm-detail">
          <span className="rhythm-detail-label">原始 Pattern</span>
          <code className="rhythm-raw">{rhythm.raw}</code>
          {rhythm.speed && rhythm.speed !== 1 && (
            <span className="rhythm-speed">速度: {rhythm.speed}x</span>
          )}
        </div>
      )}
    </div>
  );
}

/** 获取 slot 的可视化图标 */
function getSlotIcon(slot: RhythmSlot): string {
  if (slot.kind === 'pluck') {
    return slot.target === 'root' ? '◉' : '●';
  }
  switch (slot.action) {
    case 'down': return '⬇';
    case 'up': return '⬆';
    case 'mute': return '✕';
    case 'sustain': return '─';
    default: return '?';
  }
}

/** 获取 slot 的文字标签 */
function getSlotLabel(slot: RhythmSlot): string {
  if (slot.kind === 'pluck') {
    return slot.target === 'root' ? '根' : slot.strings.join('');
  }
  switch (slot.action) {
    case 'down': return '下';
    case 'up': return '上';
    case 'mute': return '闷';
    case 'sustain': return '延';
    default: return '?';
  }
}

/** 获取 CSS modifier class */
function getCellModifier(slot: RhythmSlot): string {
  if (slot.kind === 'pluck') return 'rhythm-cell--pluck-action';
  switch (slot.action) {
    case 'down': return 'rhythm-cell--down';
    case 'up': return 'rhythm-cell--up';
    case 'mute': return 'rhythm-cell--mute';
    case 'sustain': return 'rhythm-cell--sustain';
    default: return '';
  }
}

// ============================================================
//  吉他谱面板
// ============================================================

const ScorePanel = memo(function ScorePanel({ currentScoreId, onSelectScore, onDeleteScore, onLoadVersion }: {
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
        <h3 className="panel-title"><BookOpen size={14} /> 吉他谱库</h3>
        <button className="btn-tiny" onClick={loadScores} title="刷新"><RefreshCw size={12} /></button>
      </div>

      {loading ? (
        <p className="panel-empty">加载中...</p>
      ) : scores.length === 0 ? (
        <p className="panel-empty">暂无保存的吉他谱</p>
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
                  {expandedId === s.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button
                  className="btn-tiny btn-tiny--danger"
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                  title="删除"
                >
                  <Trash2 size={12} />
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
});

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
