/**
 * TAB 编辑器工具栏
 *
 * 分为两层：
 * - 主栏：段落名称 + 保存 + 核心操作
 * - 上下文栏：拍选中时显示拆拍/合拍等操作
 */
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

interface TabToolbarProps {
  // 段落
  segmentName: string;
  onSegmentNameChange: (name: string) => void;
  onSave: () => void;
  saving: boolean;
  saveMsg: string | null;
  isUpdate: boolean;
  // 撤销
  onUndo: () => void;
  onRedo: () => void;
  // 拍选中
  beatSelCount: number;
  onSplitBeat: () => void;
  onMergeBeats: () => void;
  onToggleRest: () => void;
  onCancelBeatSel: () => void;
  // 和弦提示
  hasPendingSel: boolean;
  // 拍号
  tsLabel: string;
  onTsChange: (label: string, bpm: number) => void;
  timeSigs: [string, number][];
  // 小节
  measureCount: number;
  onAddMeasure: () => void;
  onRemoveMeasure: () => void;
  // 预览
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

export function TabToolbar({
  segmentName, onSegmentNameChange, onSave, saving, saveMsg, isUpdate,
  onUndo, onRedo,
  beatSelCount, onSplitBeat, onMergeBeats, onToggleRest, onCancelBeatSel,
  hasPendingSel,
  tsLabel, onTsChange, timeSigs,
  measureCount, onAddMeasure, onRemoveMeasure,
  previewOpen, onTogglePreview,
}: TabToolbarProps) {
  const hasBeatSel = beatSelCount > 0;

  return (
    <div className="tab-toolbar-wrap">
      {/* 主栏 */}
      <div className="tab-toolbar">
        <div className="tab-toolbar-left">
          <input
            className="tab-segment-name-input"
            type="text"
            placeholder="段落名称"
            value={segmentName}
            onChange={e => onSegmentNameChange(e.target.value)}
          />
          <button className="tab-action-btn tab-save-btn" onClick={onSave} disabled={saving}>
            {saving ? '...' : isUpdate ? '更新' : '保存'}
          </button>
          {saveMsg && <span className="tab-seg-msg">{saveMsg}</span>}
        </div>
        <div className="tab-toolbar-actions">
          <button className="tab-action-btn" onClick={onUndo} title="撤销 (Ctrl+Z)">↩</button>
          <button className="tab-action-btn" onClick={onRedo} title="重做 (Ctrl+Shift+Z)">↪</button>
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
          <button className="tab-action-btn" onClick={onAddMeasure}>+ 小节</button>
          <button className="tab-action-btn" onClick={onRemoveMeasure} disabled={measureCount <= 1}>− 小节</button>
          <span className="tab-toolbar-count">{measureCount} 小节</span>
          {onTogglePreview && (
            <button className="tab-action-btn" onClick={onTogglePreview}>
              {previewOpen ? '关闭预览' : '曲谱预览'}
            </button>
          )}
        </div>
      </div>

      {/* 上下文栏 — 拍选中或和弦待填入时显示 */}
      {(hasBeatSel || hasPendingSel) && (
        <div className="tab-context-bar">
          {hasPendingSel && <span className="tab-context-hint">← 从和弦库选择和弦填入</span>}
          {hasBeatSel && (
            <>
              <span className="tab-context-info">已选 {beatSelCount} 拍</span>
              <button className="tab-ctx-btn" onClick={onSplitBeat}>拆拍</button>
              <button className="tab-ctx-btn" disabled={beatSelCount < 2} onClick={onMergeBeats}>合拍</button>
              <button className="tab-ctx-btn" onClick={onToggleRest}>休止</button>
              <button className="tab-ctx-btn tab-ctx-btn--cancel" onClick={onCancelBeatSel}>取消</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
