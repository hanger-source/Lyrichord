/**
 * TAB 编辑器工具栏
 *
 * 分为两层：
 * - 主栏：段落名称 + 保存 + 核心操作
 * - 上下文栏：拍选中时显示拆拍/合拍等操作
 */
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check, Save } from 'lucide-react';

interface TabToolbarProps {
  // 段落
  segmentName: string;
  onSegmentNameChange: (name: string) => void;
  onSave: () => void;
  saving: boolean;
  saveMsg: string | null;
  // 撤销
  onUndo: () => void;
  onRedo: () => void;
  // 拍选中（顶部）
  beatSelCount: number;
  beatSelMi: number | null;
  onSplitBeat: () => void;
  onMergeBeats: () => void;
  onToggleRest: () => void;
  onCancelBeatSel: () => void;
  // 节奏型拍选中（底部）
  rhythmSelCount: number;
  onCancelRhythmSel: () => void;
  // 和弦提示
  hasPendingSel: boolean;
  hasChordToApply: boolean;
  chordToApplyName?: string;
  onCancelChord?: () => void;
  // tempo
  tempo: number;
  onTempoChange: (t: number) => void;
  // 拍号
  tsLabel: string;
  onTsChange: (label: string, bpm: number) => void;
  timeSigs: [string, number][];
  // 小节
  measureCount: number;
  // 预览
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

export function TabToolbar({
  segmentName, onSegmentNameChange, onSave, saving, saveMsg,
  onUndo, onRedo,
  beatSelCount, beatSelMi, onSplitBeat, onMergeBeats, onToggleRest, onCancelBeatSel,
  rhythmSelCount, onCancelRhythmSel,
  hasPendingSel,
  hasChordToApply, chordToApplyName, onCancelChord,
  tempo, onTempoChange,
  tsLabel, onTsChange, timeSigs,
  measureCount,
  previewOpen, onTogglePreview,
}: TabToolbarProps) {
  const hasBeatSel = beatSelCount > 0;
  const hasRhythmSel = rhythmSelCount > 0;

  return (
    <div className="tab-toolbar-wrap">
      {/* 第一行：段落名称 + 保存 */}
      <div className="tab-toolbar tab-toolbar--row1">
        <div className="tab-toolbar-left">
          <input
            className="tab-segment-name-input"
            type="text"
            placeholder="段落名称"
            value={segmentName}
            onChange={e => onSegmentNameChange(e.target.value)}
          />
          {saveMsg && <span className="tab-seg-msg">{saveMsg}</span>}
        </div>
        <button className="tab-action-btn tab-save-btn" onClick={onSave} disabled={saving} title="保存段落 (Ctrl+S)">
          <Save size={13} /> {saving ? '...' : '保存'}
        </button>
      </div>

      {/* 第二行：编辑操作 */}
      <div className="tab-toolbar tab-toolbar--row2">
        <div className="tab-toolbar-actions">
          <button className="tab-action-btn" onClick={onUndo} title="撤销 (Ctrl+Z)">↩</button>
          <button className="tab-action-btn" onClick={onRedo} title="重做 (Ctrl+Shift+Z)">↪</button>
          <span className="tab-toolbar-divider">|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              className="radix-select-trigger radix-select-trigger--compact"
              type="number"
              min={20}
              max={300}
              value={tempo}
              onChange={e => { const v = parseInt(e.target.value, 10); if (v > 0) onTempoChange(v); }}
              style={{ width: 52, textAlign: 'center' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>bpm</span>
          </div>
          <span className="tab-toolbar-divider">|</span>
          <Select.Root
            value={tsLabel}
            onValueChange={val => { const o = timeSigs.find(t => t[0] === val); if (o) onTsChange(o[0], o[1]); }}
          >
            <Select.Trigger className="radix-select-trigger radix-select-trigger--compact">
              <Select.Value />
              <Select.Icon className="radix-select-icon"><ChevronDown size={11} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="radix-select-content" position="popper" sideOffset={4}>
                <Select.Viewport className="radix-select-viewport">
                  {timeSigs.map(([l]) => (
                    <Select.Item key={l} className="radix-select-item" value={l}>
                      <Select.ItemText>{l}</Select.ItemText>
                      <Select.ItemIndicator className="radix-select-indicator"><Check size={11} /></Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <span className="tab-toolbar-divider">|</span>
          <span className="tab-toolbar-count">{measureCount} 小节</span>
        </div>
        {onTogglePreview && (
          <button className="tab-action-btn" onClick={onTogglePreview} style={{ marginLeft: 'auto' }}>
            {previewOpen ? '关闭预览' : '曲谱预览'}
          </button>
        )}
      </div>

      {/* 上下文栏 — 栈式优先级，只显示最高优先级状态 */}
      {(() => {
        // 优先级：和弦填入中 > 拍位待填 > 和弦已选待拖 > 节奏型选中 > 拍选中
        if (hasPendingSel && hasChordToApply) return (
          <div className="tab-context-bar">
            <span className="tab-context-hint">正在填入 <strong>{chordToApplyName}</strong>...</span>
          </div>
        );
        if (hasPendingSel && !hasChordToApply) return (
          <div className="tab-context-bar">
            <span className="tab-context-hint">已选拍位，点击左侧和弦库填入</span>
            <button className="tab-ctx-btn tab-ctx-btn--cancel" onClick={onCancelChord}>取消 (Esc)</button>
          </div>
        );
        if (hasChordToApply && !hasPendingSel) return (
          <div className="tab-context-bar">
            <span className="tab-context-hint">已选 <strong>{chordToApplyName}</strong>，在和弦行拖选拍位以填入</span>
            <button className="tab-ctx-btn tab-ctx-btn--cancel" onClick={onCancelChord}>取消 (Esc)</button>
          </div>
        );
        if (hasRhythmSel) return (
          <div className="tab-context-bar">
            <span className="tab-context-info">♩ 已选 {rhythmSelCount} 拍</span>
            <span className="tab-context-hint">点击右侧节奏型应用</span>
            <button className="tab-ctx-btn tab-ctx-btn--cancel" onClick={onCancelRhythmSel}>取消</button>
          </div>
        );
        if (hasBeatSel) return (
          <div className="tab-context-bar">
            <span className="tab-context-info">已选 {beatSelCount} 拍 (小节 {(beatSelMi ?? 0) + 1})</span>
            <button className="tab-ctx-btn" onClick={onSplitBeat}>拆拍</button>
            <button className="tab-ctx-btn" disabled={beatSelCount < 2} onClick={onMergeBeats}>合拍</button>
            <button className="tab-ctx-btn" onClick={onToggleRest}>休止</button>
            <button className="tab-ctx-btn tab-ctx-btn--cancel" onClick={onCancelBeatSel}>取消</button>
          </div>
        );
        return <div className="tab-context-bar--placeholder" />;
      })()}
    </div>
  );
}
