/**
 * 侧边栏 — 和弦库 / 节奏型库 / 吉他谱库
 *
 * 使用 Radix UI 组件: Tabs, Tooltip, ScrollArea
 */
import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import {
  Music, Drum, RefreshCw, Trash2, BookOpen,
  ChevronDown, ChevronRight, Search, Plus, X, Check, Pencil,
} from 'lucide-react';
import type { SidebarTab } from '../hooks/useAppState';
import type { Song, ChordDefinition, RhythmPattern, RhythmSlot, RhythmType, PluckSlot, StrumSlot } from '../../core/types';
import { renderChordDiagram } from '../chord-diagram';
import { resolveChord } from '../../core/chord/resolver';
import { getAllChordDefs, searchChordsInDB } from '../../core/chord/database';
import { getChordsBySource } from '../../db/chord-repo';
import { getAllRhythms, upsertRhythm, deleteRhythm } from '../../db/rhythm-repo';
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
  onChordPick?: (chordName: string, positionIndex: number) => void;
  /** 从 TAB 编辑器点击和弦 → 高亮对应卡片 */
  highlightChord?: { name: string; positionIndex?: number } | null;
  onHighlightClear?: () => void;
  /** 用户在 Sidebar 切换指法变体 → 同步更新 TAB 里同名和弦的 positionIndex */
  onChordPositionChange?: (chordName: string, positionIndex: number) => void;
  /** TAB 模式下，点击节奏型卡片 → 应用到段落 */
  onRhythmPick?: (rhythm: RhythmPattern) => void;
  /** 新建/编辑/删除节奏型后回调 → 刷新补全数据 + 同步 TMD */
  onRhythmChanged?: (change?: { oldId?: string; pattern: RhythmPattern } | { deleted: string }) => void;
}

export const Sidebar = memo(function Sidebar({ tab, song, currentScoreId, onSelectScore, onDeleteScore, onLoadVersion, onChordPick, highlightChord, onHighlightClear, onChordPositionChange, onRhythmPick, onRhythmChanged }: SidebarProps) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <aside className="sidebar">
        <div style={{ display: tab === 'chords' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ChordPanel song={song} onChordPick={onChordPick} highlightChord={highlightChord} onHighlightClear={onHighlightClear} onChordPositionChange={onChordPositionChange} />
        </div>
        <div style={{ display: tab === 'rhythms' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <ScrollArea.Root className="sidebar-scroll-root">
            <ScrollArea.Viewport className="sidebar-scroll-viewport">
              <RhythmPanel song={song} onRhythmPick={onRhythmPick} onRhythmChanged={onRhythmChanged} />
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

const ChordPanel = memo(function ChordPanel({ song, onChordPick, highlightChord, onHighlightClear, onChordPositionChange }: { song: Song | null; onChordPick?: (name: string, positionIndex: number) => void; highlightChord?: { name: string; positionIndex?: number } | null; onHighlightClear?: () => void; onChordPositionChange?: (name: string, positionIndex: number) => void }) {
  const [viewMode, setViewMode] = useState<'current' | 'library'>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryChords, setLibraryChords] = useState<ChordDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const currentChordIds = song ? collectChordIds(song) : [];

  // 高亮和弦 → 自动切到全部库（滚动由 ChordCardDef 自己处理）
  const highlightScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightChord) return;
    setFilterType('all');
    setSearchQuery('');
    if (viewMode !== 'library') {
      highlightScrollRef.current = highlightChord.name;
      setViewMode('library');
    }
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
      // 清除待滚动标记（滚动由 ChordCardDef 的 highlight effect 处理）
      highlightScrollRef.current = null;
    } catch (e) {
      console.error('加载和弦库失败:', e);
    } finally {
      setLoading(false);
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToRoot(root: string) {
    setActiveRoot(root);
    // 双重 rAF 确保 DOM 布局完成（Sidebar 从 display:none 切换后需要额外一帧）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = groupRefs.current.get(root);
        const container = scrollRef.current;
        if (el && container) {
          const containerRect = container.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          container.scrollTop += elRect.top - containerRect.top;
        }
      });
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
                      highlight={highlightChord?.name === chord.id}
                      highlightPositionIndex={highlightChord?.name === chord.id ? highlightChord.positionIndex : undefined}
                      onHighlightClear={onHighlightClear}
                      onPositionChange={onChordPositionChange}
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

function ChordCardDef({ chord, onPick, highlight, highlightPositionIndex, onHighlightClear, onPositionChange }: { chord: ChordDefinition; onPick?: (name: string, positionIndex: number) => void; highlight?: boolean; highlightPositionIndex?: number; onHighlightClear?: () => void; onPositionChange?: (name: string, positionIndex: number) => void }) {
  const [selectedPos, setSelectedPos] = useState(0);
  const variantCount = chord.positions?.length ?? 0;
  const cardRef = useRef<HTMLDivElement>(null);

  // 高亮时滚动到可见区域 + 同步指法变体
  useEffect(() => {
    if (!highlight || !cardRef.current) return;

    // 同步指法变体
    if (highlightPositionIndex != null && highlightPositionIndex !== selectedPos) {
      setSelectedPos(highlightPositionIndex);
    }

    const el = cardRef.current;
    const container = el.closest('.chord-panel-scroll') as HTMLElement | null;

    const doScroll = () => {
      if (!container) return;
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const offset = elRect.top - cRect.top + container.scrollTop - cRect.height / 2 + elRect.height / 2;
      container.scrollTo({ top: Math.max(0, offset), behavior: 'instant' });
    };

    const scrollTimer = setTimeout(doScroll, 16);
    // 3秒后清除高亮
    const clearTimer = setTimeout(() => onHighlightClear?.(), 3000);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [highlight, highlightPositionIndex, onHighlightClear]);

  const displayChord = variantCount > 1
    ? { ...chord, selectedPosition: selectedPos }
    : chord;

  function cycleVariant(e: React.MouseEvent) {
    e.stopPropagation();
    if (variantCount > 1) {
      const next = (selectedPos + 1) % variantCount;
      setSelectedPos(next);
      onPositionChange?.(chord.id, next);
    }
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div
          ref={cardRef}
          className={`chord-card ${onPick ? 'chord-card--pickable' : ''} ${highlight ? 'chord-card--highlight' : ''}`}
          onClick={onPick ? () => onPick(chord.id, selectedPos) : undefined}
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

const RhythmPanel = memo(function RhythmPanel({ song, onRhythmPick, onRhythmChanged }: { song: Song | null; onRhythmPick?: (rhythm: RhythmPattern) => void; onRhythmChanged?: SidebarProps['onRhythmChanged'] }) {
  const [viewMode, setViewMode] = useState<'current' | 'library'>('current');
  const [dbRhythms, setDbRhythms] = useState<RhythmPattern[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // null = 不在编辑, '__new__' = 新建, 其他 = 编辑已有

  // 从 DB 加载全部节奏型
  const loadDbRhythms = useCallback(async () => {
    try { setDbRhythms(await getAllRhythms()); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (viewMode === 'library') loadDbRhythms();
  }, [viewMode, song, loadDbRhythms]);

  // 当前 = TMD 里定义的
  const currentRhythms = song ? Array.from(song.rhythmLibrary.values()) : [];

  // 当前面板为空时自动切到全部
  useEffect(() => {
    if (viewMode === 'current' && currentRhythms.length === 0) {
      setViewMode('library');
    }
  }, [currentRhythms.length, viewMode]);

  const rhythms = viewMode === 'current' ? currentRhythms : dbRhythms;

  // 收集所有已有 ID
  function allIds(): Set<string> {
    return new Set([
      ...currentRhythms.map(r => r.id),
      ...dbRhythms.map(r => r.id),
    ]);
  }

  async function handleSave(pattern: RhythmPattern) {
    try {
      const oldId = (pattern as any)._oldId as string | undefined;
      // 如果 ID 变了（内容修改导致），先删旧记录
      if (oldId) {
        await deleteRhythm(oldId);
      }
      await upsertRhythm(pattern, 'user');
      await loadDbRhythms();
      onRhythmChanged?.({ oldId, pattern });
      setEditingId(null);
    } catch (e) {
      console.error('保存节奏型失败:', e);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteRhythm(id);
      await loadDbRhythms();
      onRhythmChanged?.({ deleted: id });
    } catch (e) {
      console.error('删除节奏型失败:', e);
    }
  }

  return (
    <div className="sidebar-panel">
      <div className="panel-header">
        <h3 className="panel-title"><Drum size={14} /> 节奏型</h3>
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

      {/* 新建按钮 */}
      {editingId === null && (
        <button
          className="rhythm-add-btn"
          onClick={() => setEditingId('__new__')}
        >
          <Plus size={13} /> 新建节奏型
        </button>
      )}

      {/* 新建编辑区 */}
      {editingId === '__new__' && (
        <RhythmEditor
          onSave={handleSave}
          onCancel={() => setEditingId(null)}
          existingIds={allIds()}
        />
      )}

      {rhythms.length === 0 && editingId === null ? (
        <p className="panel-empty">
          {viewMode === 'current' ? '当前曲目暂无节奏型' : '节奏型库为空'}
        </p>
      ) : (
        <div className="rhythm-list">
          {rhythms.map(r => (
            editingId === r.id ? (
              <RhythmEditor
                key={r.id}
                initial={r}
                onSave={handleSave}
                onCancel={() => setEditingId(null)}
                existingIds={allIds()}
              />
            ) : (
              <RhythmCard
                key={r.id}
                rhythm={r}
                onPick={onRhythmPick}
                onEdit={viewMode === 'library' ? () => setEditingId(r.id) : undefined}
                onDelete={viewMode === 'library' ? () => handleDelete(r.id) : undefined}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
});

function RhythmCard({ rhythm, onPick, onEdit, onDelete }: { rhythm: RhythmPattern; onPick?: (rhythm: RhythmPattern) => void; onEdit?: () => void; onDelete?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const slotsPerBeat = rhythm.slots.length >= 8 ? Math.ceil(rhythm.slots.length / 4) : Math.ceil(rhythm.slots.length / 2);

  return (
    <div className={`rhythm-card ${onPick ? 'rhythm-card--pickable' : ''}`}
      onClick={() => onPick ? onPick(rhythm) : setExpanded(!expanded)}>
      <div className="rhythm-header">
        <span className="rhythm-id">@{rhythm.id}</span>
        <div className="rhythm-header-right">
          {onEdit && (
            <button className="btn-tiny" title="编辑" onClick={e => { e.stopPropagation(); onEdit(); }}>
              <Pencil size={11} />
            </button>
          )}
          {onDelete && (
            <button className="btn-tiny btn-tiny--danger" title="删除" onClick={e => { e.stopPropagation(); onDelete(); }}>
              <Trash2 size={11} />
            </button>
          )}
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

// ---- 扫弦动作循环 ----
const STRUM_CYCLE: StrumSlot['action'][] = ['down', 'up', 'mute', 'sustain'];

/** 从 slots 反向生成 raw 字符串（给代码/DB 用） */
function slotsToRaw(slots: RhythmSlot[]): string {
  return slots.map(s => {
    if (s.kind === 'strum') {
      let ch: string;
      switch (s.action) {
        case 'down': ch = 'D'; break;
        case 'up': ch = 'U'; break;
        case 'mute': ch = 'X'; break;
        case 'sustain': ch = '-'; break;
      }
      // fromRoot：D* 格式（从根音弦开始扫）
      if (s.fromRoot) return `${ch}*`;
      // 部分弦：D[123] 格式
      if (s.strings && s.strings.length > 0 && s.strings.length < 6) {
        return `${ch}[${s.strings.join('')}]`;
      }
      return ch;
    }
    // pluck
    if (s.target === 'root') return 'p';
    return s.strings.length === 1 ? String(s.strings[0]) : `(${s.strings.join('')})`;
  }).join('-');
}

function makeDefaultSlots(type: RhythmType, count: number): RhythmSlot[] {
  if (type === 'strum') {
    return Array.from({ length: count }, (): StrumSlot => ({ kind: 'strum', action: 'down' }));
  }
  return Array.from({ length: count }, (): PluckSlot => ({ kind: 'pluck', target: 'root' }));
}

function cycleStrumSlot(slot: StrumSlot): StrumSlot {
  const idx = STRUM_CYCLE.indexOf(slot.action);
  const next = STRUM_CYCLE[(idx + 1) % STRUM_CYCLE.length];
  if (slot.fromRoot) return { kind: 'strum', action: next, fromRoot: true };
  return slot.strings ? { kind: 'strum', action: next, strings: slot.strings } : { kind: 'strum', action: next };
}

/** 计算 fixed 弹出面板的坐标 */
/** 根据 anchor 元素计算 fixed 定位坐标，确保在视口内 */
function calcPickerPos(anchor: HTMLElement, pickerW: number): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const pickerH = 34;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = r.top > pickerH + 8 ? r.top - pickerH - 4 : r.bottom + 4;
  top = Math.max(8, Math.min(top, vh - pickerH - 8));
  let left = Math.max(8, Math.min(r.left, vw - pickerW - 8));
  return { top, left };
}

/** 拨弦 slot 的弦选择弹出面板 */
function PluckSlotPicker({ slot, onChange, onClose, pos }: {
  slot: PluckSlot;
  onChange: (s: PluckSlot) => void;
  onClose: () => void;
  pos: { top: number; left: number };
}) {
  const isRoot = slot.target === 'root';
  const selected = isRoot ? new Set<number | 'root'>(['root']) : new Set<number | 'root'>(slot.strings);
  const ref = useRef<HTMLDivElement>(null);

  function toggle(target: number | 'root') {
    const next = new Set(selected);
    if (target === 'root') {
      onChange({ kind: 'pluck', target: 'root' });
      return;
    }
    next.delete('root');
    if (next.has(target)) {
      next.delete(target);
    } else {
      next.add(target);
    }
    const nums = [...next].filter((v): v is number => typeof v === 'number').sort();
    if (nums.length === 0) {
      onChange({ kind: 'pluck', target: 'root' });
    } else {
      onChange({ kind: 'pluck', target: 'strings', strings: nums });
    }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    // 用 setTimeout 延迟注册，避免打开面板的那次 mousedown 立即触发关闭
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  return createPortal(
    <div className="pluck-picker" ref={ref} style={pos}>
      <button
        className={`pluck-picker-btn ${isRoot ? 'pluck-picker-btn--active' : ''}`}
        onClick={() => toggle('root')}
      >根</button>
      {[6, 5, 4, 3, 2, 1].map(n => (
        <button
          key={n}
          className={`pluck-picker-btn ${!isRoot && selected.has(n) ? 'pluck-picker-btn--active' : ''}`}
          onClick={() => toggle(n)}
        >{n}</button>
      ))}
    </div>,
    document.body
  );
}

/** 扫弦弦范围选择面板 — 右键扫弦格子弹出，支持拖选 */
function StrumStringPicker({ slot, onChange, onClose, pos }: {
  slot: StrumSlot;
  onChange: (s: StrumSlot) => void;
  onClose: () => void;
  pos: { top: number; left: number };
}) {
  const selected = new Set<number>(slot.strings ?? []);
  const isAll = selected.size === 0 && !slot.fromRoot;
  const isFromRoot = !!slot.fromRoot;
  const dragging = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  function applySelection(nums: number[]) {
    onChange(nums.length === 0 || nums.length === 6
      ? { kind: 'strum', action: slot.action }
      : { kind: 'strum', action: slot.action, strings: nums });
  }

  function toggle(n: number) {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n); else next.add(n);
    applySelection([...next].sort());
  }

  function setAll() {
    onChange({ kind: 'strum', action: slot.action });
  }

  function setFromRoot() {
    onChange({ kind: 'strum', action: slot.action, fromRoot: true });
  }

  function handleDragStart(n: number, e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    applySelection([n]);
  }

  function handleDragEnter(n: number) {
    if (!dragging.current) return;
    const next = new Set(selected);
    next.add(n);
    applySelection([...next].sort());
  }

  useEffect(() => {
    function handleUp() { dragging.current = false; }
    document.addEventListener('mouseup', handleUp);
    return () => document.removeEventListener('mouseup', handleUp);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  return createPortal(
    <div className="pluck-picker" ref={ref} style={pos}>
      <button
        className={`pluck-picker-btn ${isAll ? 'pluck-picker-btn--active' : ''}`}
        onClick={setAll}
      >全</button>
      <button
        className={`pluck-picker-btn ${isFromRoot ? 'pluck-picker-btn--active' : ''}`}
        onClick={setFromRoot}
        title="从根音弦开始扫"
      >根</button>
      {[6, 5, 4, 3, 2, 1].map(n => (
        <button
          key={n}
          className={`pluck-picker-btn ${!isAll && !isFromRoot && selected.has(n) ? 'pluck-picker-btn--active' : ''}`}
          onClick={() => toggle(n)}
          onMouseDown={e => handleDragStart(n, e)}
          onMouseEnter={() => handleDragEnter(n)}
        >{n}</button>
      ))}
    </div>,
    document.body
  );
}

/** 从 slots 内容生成确定性短 ID */
function deriveId(type: RhythmType, slots: RhythmSlot[], existingIds: Set<string>): string {
  const prefix = type === 'strum' ? 'S' : 'P';
  const raw = slotsToRaw(slots);
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  const hash = (h >>> 0).toString(36).padStart(5, '0').slice(0, 5);
  const base = `${prefix}${slots.length}-${hash}`;
  if (!existingIds.has(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return base;
}

// ---- 节奏型编辑器（可视化交互） ----

function RhythmEditor({ initial, onSave, onCancel, existingIds }: {
  initial?: RhythmPattern;
  onSave: (pattern: RhythmPattern) => void;
  onCancel: () => void;
  existingIds: Set<string>;
}) {
  const [type, setType] = useState<RhythmType>(initial?.type ?? 'strum');
  const [slots, setSlots] = useState<RhythmSlot[]>(
    initial?.slots ?? makeDefaultSlots('strum', 4)
  );
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 实时预览 ID — 始终根据内容计算
  const previewId = deriveId(type, slots, existingIds);

  function handleTypeChange(newType: RhythmType) {
    if (newType === type) return;
    setType(newType);
    setSlots(makeDefaultSlots(newType, slots.length));
    setPickerIndex(null);
  }

  function handleSlotClick(index: number, e?: React.MouseEvent) {
    if (type === 'strum') {
      setSlots(prev => {
        const next = [...prev];
        next[index] = cycleStrumSlot(next[index] as StrumSlot);
        return next;
      });
    } else {
      // 拨弦：打开弦选择面板
      if (pickerIndex === index) {
        setPickerIndex(null);
      } else {
        if (e) {
          const anchor = (e.currentTarget as HTMLElement).closest('.rhythm-slot-wrapper') as HTMLElement | null;
          if (anchor) setPickerPos(calcPickerPos(anchor, 210));
        }
        setPickerIndex(index);
      }
    }
  }

  /** 右键扫弦格子 → 弹出弦范围选择 */
  function handleSlotContextMenu(e: React.MouseEvent, index: number) {
    if (type !== 'strum') return;
    e.preventDefault();
    if (pickerIndex === index) {
      setPickerIndex(null);
    } else {
      const anchor = (e.currentTarget as HTMLElement).closest('.rhythm-slot-wrapper') as HTMLElement | null;
      const pos = anchor ? calcPickerPos(anchor, 260) : { top: 100, left: 100 };
      setPickerPos(pos);
      setPickerIndex(index);
    }
  }

  function handlePluckChange(index: number, newSlot: PluckSlot) {
    setSlots(prev => {
      const next = [...prev];
      next[index] = newSlot;
      return next;
    });
  }

  function handleStrumStringChange(index: number, newSlot: StrumSlot) {
    setSlots(prev => {
      const next = [...prev];
      next[index] = newSlot;
      return next;
    });
  }

  function addSlot() {
    setSlots(prev => [
      ...prev,
      type === 'strum'
        ? { kind: 'strum', action: 'down' } as StrumSlot
        : { kind: 'pluck', target: 'root' } as PluckSlot,
    ]);
  }

  function removeSlot() {
    if (slots.length <= 2) return;
    setPickerIndex(null);
    setSlots(prev => prev.slice(0, -1));
  }

  function handleSave() {
    // 始终根据内容重新生成 ID（确定性：同内容→同 ID）
    const newId = deriveId(type, slots, existingIds);
    const finalId = initial?.id && initial.id === newId ? initial.id : newId;
    onSave({ id: finalId, type, raw: slotsToRaw(slots), slots, _oldId: initial?.id !== finalId ? initial?.id : undefined } as any);
  }

  const slotsPerBeat = slots.length >= 8 ? Math.ceil(slots.length / 4) : Math.ceil(slots.length / 2);

  return (
    <div className="rhythm-editor">
      {/* 第一行: 自动ID + 类型 */}
      <div className="rhythm-editor-row">
        <span className="rhythm-id">@{previewId}</span>
        <div className="rhythm-editor-type-toggle">
          <button
            className={`rhythm-type-btn ${type === 'strum' ? 'rhythm-type-btn--active rhythm-type-btn--strum' : ''}`}
            onClick={() => handleTypeChange('strum')}
          >扫弦</button>
          <button
            className={`rhythm-type-btn ${type === 'pluck' ? 'rhythm-type-btn--active rhythm-type-btn--pluck' : ''}`}
            onClick={() => handleTypeChange('pluck')}
          >拨弦</button>
        </div>
      </div>

      {/* 拍位数量控制 */}
      <div className="rhythm-editor-row">
        <label className="rhythm-editor-label">拍位</label>
        <div className="rhythm-slot-stepper">
          <button className="stepper-btn" onClick={removeSlot} disabled={slots.length <= 2}>−</button>
          <span className="stepper-value">{slots.length}</span>
          <button className="stepper-btn" onClick={addSlot} disabled={slots.length >= 16}>+</button>
        </div>
        <span className="rhythm-editor-tip">
          {type === 'strum' ? '左键切换动作 · 右键选弦' : '点击格子选择弦'}
        </span>
      </div>

      {/* 可视化格子 */}
      <div className="rhythm-visual rhythm-editor-grid">
        {slots.map((slot, i) => {
          const isBeatBoundary = i > 0 && i % slotsPerBeat === 0;
          return (
            <div key={i} className="rhythm-visual-group">
              {isBeatBoundary && <div className="rhythm-beat-divider" />}
              <div className="rhythm-slot-wrapper">
                <div
                  className={`rhythm-cell rhythm-cell--${slot.kind} ${getCellModifier(slot)} rhythm-cell--editable`}
                  onClick={e => handleSlotClick(i, e)}
                  onContextMenu={e => handleSlotContextMenu(e, i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSlotClick(i); }}
                >
                  <span className="rhythm-cell-icon">{getSlotIcon(slot)}</span>
                  <span className="rhythm-cell-label">{getSlotLabel(slot)}</span>
                </div>
                {pickerIndex === i && slot.kind === 'pluck' && (
                  <PluckSlotPicker
                    slot={slot as PluckSlot}
                    onChange={s => handlePluckChange(i, s)}
                    onClose={() => setPickerIndex(null)}
                    pos={pickerPos}
                  />
                )}
                {pickerIndex === i && slot.kind === 'strum' && (
                  <StrumStringPicker
                    slot={slot as StrumSlot}
                    onChange={s => handleStrumStringChange(i, s)}
                    onClose={() => setPickerIndex(null)}
                    pos={pickerPos}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 操作按钮 */}
      <div className="rhythm-editor-actions">
        <button className="rhythm-editor-btn rhythm-editor-btn--cancel" onClick={onCancel}>
          <X size={12} /> 取消
        </button>
        <button
          className="rhythm-editor-btn rhythm-editor-btn--save"
          onClick={handleSave}
          disabled={slots.length === 0}
        >
          <Check size={12} /> 保存
        </button>
      </div>
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
  let label: string;
  switch (slot.action) {
    case 'down': label = '下'; break;
    case 'up': label = '上'; break;
    case 'mute': label = '闷'; break;
    case 'sustain': label = '延'; break;
    default: label = '?';
  }
  if (slot.fromRoot) {
    label += '根';
  } else if (slot.strings && slot.strings.length > 0 && slot.strings.length < 6) {
    label += slot.strings.join('');
  }
  return label;
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
