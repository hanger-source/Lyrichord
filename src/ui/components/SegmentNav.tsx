/**
 * 段落导航面板 — TAB 工作区左侧
 *
 * 纯段落列表 + 新建/删除。项目选择已提升到 Header。
 */
import { Plus, Trash2 } from 'lucide-react';
import type { SegmentRecord } from '../../db/segment-repo';

interface SegmentNavProps {
  segments: SegmentRecord[];
  activeSegmentId: string | null;
  onSelectSegment: (seg: SegmentRecord) => void;
  onNewSegment: () => void;
  onDeleteSegment: (id: string) => void;
}

export function SegmentNav({
  segments, activeSegmentId,
  onSelectSegment, onNewSegment, onDeleteSegment,
}: SegmentNavProps) {
  return (
    <div className="seg-nav">
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
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="seg-nav-add-btn" onClick={onNewSegment}>
        <Plus size={14} /> 新建段落
      </button>
    </div>
  );
}

function countMeasures(json: string): number {
  try { return JSON.parse(json).length; } catch { return 0; }
}
