# TAB 编辑器设计研究报告

> 基于 calesce/tab-editor、powertab/powertabeditor、helge17/tuxguitar 三个开源项目的源码分析

## 1. 三个项目概览

| 维度 | tab-editor | powertabeditor | tuxguitar |
|------|-----------|----------------|-----------|
| 语言 | JavaScript (React/Redux) | C++ (Qt) | Java (SWT) |
| 定位 | 轻量浏览器 TAB 编辑器 | 专业桌面 TAB 编辑器 | 全功能桌面吉他谱编辑器 |
| 渲染 | SVG | Qt Graphics Scene | 自定义 Canvas (UIPainter) |
| 数据模型复杂度 | 简单 | 中等 | 复杂 |
| 多声部 | ❌ | ✅ (2 voices) | ✅ (2 voices) |
| 标准记谱 | ❌ | ✅ | ✅ |
| 连音/Tuplet | 简单 (tuplet 字段) | IrregularGrouping | DivisionType (支持 3:2 到 13:8) |
| Undo/Redo | Redux 天然支持 | QUndoCommand 命令模式 | Action 系统 |
| 文件格式 | 无 (内存状态) | 自有 JSON + GP 导入 | .tg + GP/GPX/PTB/ASCII/LilyPond |

## 2. 数据模型对比

### 2.1 层级结构

```
tab-editor (最简):
  Song → Track[] → Measure[] → Note[]
  Note = { string[], fret[], duration, dotted?, tuplet?, tremolo?, trill?, vibrato? }

powertabeditor (中等):
  Score → System[] → Staff[] → Voice[2] → Position[] → Note[]
         ↘ Barline[] (含 TimeSignature, KeySignature)
         ↘ TempoMarker[], ChordText[], Direction[]
  Position = { position, durationType, properties(bitflags), notes[] }
  Note = { string, fretNumber, properties(bitflags), trill?, bend?, harmonic? }

tuxguitar (最复杂):
  Song → Track[] → Measure[] → Beat[] → Voice[2] → Note[]
       ↘ MeasureHeader[] (共享: tempo, timeSignature, repeatOpen/Close)
       ↘ Channel[]
  Beat = { start/preciseStart, voices[2], chord?, text?, stroke, pickStroke }
  Voice = { duration, notes[], direction, empty }
  Note = { value(fret), string, velocity, tiedNote, effect(NoteEffect) }
  Duration = { value(1/2/4/8/16/32/64), dotted, doubleDotted, divisionType }
  DivisionType = { enters, times } // 3:2=三连音, 5:4=五连音, 7:4, 9:8, 11:8, 13:8
```

### 2.2 关键设计差异

#### Position vs Beat 模型

powertabeditor 用 `Position`（位置索引）定位音符在小节中的位置，是一个抽象的"槽位"概念。
tuxguitar 用 `Beat`（时间戳）定位，每个 Beat 有精确的 `preciseStart` 时间值。

powertabeditor 的方式更适合编辑器交互（光标在槽位间移动），tuxguitar 的方式更适合精确的时间计算和 MIDI 回放。

#### Duration 归属

- tab-editor: Duration 在 Note 上（每个音符独立时值）
- powertabeditor: Duration 在 Position 上（同一位置的所有音符共享时值）
- tuxguitar: Duration 在 Voice 上（同一 Beat 的同一 Voice 共享时值）

powertabeditor 和 tuxguitar 的设计更合理：同一时刻弹响的多个音符（和弦）应该共享时值。

#### MeasureHeader 共享模式 (tuxguitar 独有)

tuxguitar 把小节的元信息（拍号、速度、反复记号）抽到 `MeasureHeader` 中，所有 Track 的同一小节共享同一个 Header。这避免了多轨时元信息不一致的问题。

### 2.3 音效/技巧系统对比

```
tab-editor:
  Note 上直接挂 boolean 标记: dotted, tremolo, vibrato, trill, tuplet

powertabeditor:
  Position.SimpleProperty (bitflags): Dotted, DoubleDotted, Rest, Vibrato, WideVibrato,
    ArpeggioUp/Down, PickStrokeUp/Down, Staccato, Marcato, Sforzando,
    TremoloPicking, PalmMuting, Tap, Acciaccatura, TripletFeel, LetRing, Fermata
  Note.SimpleProperty (bitflags): Tied, Muted, HammerOn/PullOff, NaturalHarmonic,
    GhostNote, Octave8va/15ma/8vb/15mb, SlideIn/Out/Shift/Legato
  Note 上的复杂效果: Trill, TappedHarmonic, ArtificialHarmonic, Bend, LeftHandFingering
  Position 上的复杂效果: VolumeSwell, TremoloBar

tuxguitar:
  NoteEffect 对象 (独立类): bend, tremoloBar, harmonic, grace, trill, tremoloPicking
  NoteEffect boolean: vibrato, deadNote, slide, hammer, ghostNote, accentuatedNote,
    heavyAccentuatedNote, palmMute, staccato, tapping, slapping, popping, fadeIn, letRing
  Beat 级别: Stroke(方向+速度), PickStroke
  互斥逻辑: 设置某效果时自动清除不兼容的效果
```

## 3. 编辑操作模式对比

### 3.1 tab-editor — Redux Reducer 模式

最简单直接。每个操作是一个纯函数：`(state, action) => newState`

核心操作：
- `CHANGE_NOTE`: 在指定位置设置品位号
- `INSERT_NOTE`: 在光标后插入新音符（继承前一个音符的时值）
- `DELETE_NOTE`: 删除音符或清除某弦上的品位
- `CHANGE_NOTE_LENGTH`: 直接设置时值
- `INCREASE/DECREASE_NOTE_LENGTH`: 时值升降（w↔h↔q↔e↔s↔t）
- `TOGGLE_NOTE_DOTTED/TREMOLO/VIBRATO/TRILL`: 切换效果
- `SET_NOTE_TUPLET`: 设置连音
- `MAKE_NOTE_REST`: 转为休止符
- `PASTE_NOTE / CUT_NOTE`: 剪贴板操作

光标导航（cursor.js）：
- `getNextNote / getPrevNote`: 水平移动
- `getUpperString / getLowerString`: 垂直移动（弦间）
- 跨小节自动跳转

键盘快捷键：
- 0-9: 输入品位号（支持两位数：先按1再按2=12品）
- ←→: 水平移动光标
- ↑↓: 弦间移动
- +/-: 时值增减
- .: 附点
- R: 休止符
- I: 插入
- Space: 播放

### 3.2 powertabeditor — Command 模式 (QUndoCommand)

每个编辑操作是一个 Command 对象，有 `redo()` 和 `undo()` 方法。

核心 Commands：
- `AddNote`: 在当前位置添加音符（如果位置不存在则创建 Position）
- `RemoveNote`: 删除音符（如果 Position 空了则删除 Position）
- `EditNoteDuration`: 修改时值
- `AddRest`: 添加休止符
- `AddPositionProperty / RemovePositionProperty`: 切换 Position 级别属性
- `AddNoteProperty / RemoveNoteProperty`: 切换 Note 级别属性
- `InsertNotes`: 批量插入
- `ShiftPositions`: 移动位置
- `ShiftString`: 弦间移动音符

定位系统 (ScoreLocation)：
- 5 维坐标: `(systemIndex, staffIndex, positionIndex, voiceIndex, string)`
- 支持选区: `selectionStart` + `positionIndex` 定义范围
- `getSelectedPositions()`: 获取选区内所有 Position

UndoManager：
- 基于 Qt 的 QUndoGroup/QUndoStack
- 支持 macro（将多个命令合并为一个撤销单元）
- 每个文档一个 UndoStack
- 信号通知重绘（精确到 system 级别）

### 3.3 tuxguitar — Manager + Action 模式

TGMeasureManager 是核心编辑引擎，提供 60+ 个方法操作小节内容。
TGAction 系统提供高层操作，通过 TGActionManager 分发。

核心编辑方法 (TGMeasureManager)：
- `addNote(measure, start, note, duration, voice)`: 添加音符到指定时间位置
- `removeNote(note)`: 删除音符
- `changeDuration(measure, beat, duration, voiceIndex, tryMove)`: 修改时值（自动处理后续音符移动）
- `validateDuration(measure, beat, voiceIndex, duration, moveNextBeats, setCurrentDuration)`: 验证时值是否合法
- `autoCompleteSilences(measure)`: 自动用休止符填充空白
- `moveOutOfBoundsBeatsToNewMeasure(measure)`: 超出小节的 Beat 自动移到下一小节
- `transposeNotes(measure, transposition, tryKeepString, applyToChords)`: 移调
- `shiftNoteUp/Down(measure, start, string)`: 弦间移动
- `getMeasureErrors(measure)`: 检测小节错误（时值溢出/不足等）
- `fixVoice(measure, voiceIndex, errCode)`: 自动修复小节错误

精确时间系统 (TGDuration)：
- `QUARTER_TIME = 960` ticks（传统 MIDI 精度，有舍入误差）
- `WHOLE_PRECISE_DURATION`: 精确时间单位（LCM 所有可能的连音分割）
- `preciseStart / preciseTime`: 无损精度的时间表示
- `splitPreciseDuration()`: 将任意时长拆分为合法时值组合
- `fromTime()`: 从 tick 数反推 Duration 对象（含 threshold 容错）

## 4. 渲染/布局系统对比

### 4.1 tab-editor — SVG 直接渲染

布局计算 (scoreLayout.js)：
- 每个音符固定宽度 59px
- 按容器宽度自动换行（computeTrackLayout → trackWithRows）
- 行高根据内容动态计算（getRowHeights）
- 无标准记谱，只有 TAB 谱

渲染 (TabMeasure.js + TabNote.js)：
- React 组件直接输出 SVG
- 音符 = 弦线上的数字
- 符干/符尾根据 duration 类型绘制
- 光标 = 高亮矩形

### 4.2 powertabeditor — Qt Graphics Scene

布局计算 (LayoutInfo)：
- 双谱表：标准记谱 + TAB 谱
- 精确的间距计算：position spacing、staff height、line spacing
- 符号分组 (SymbolGroup)：将连续的同类符号（vibrato、let ring 等）合并渲染
- 垂直布局 (VerticalLayout)：处理符号重叠（bend、tremolo bar 等）
- Beam 分组 (BeamGroup)：自动计算符杠连接

渲染 (SystemRenderer)：
- 每个 System 独立渲染
- 分层绘制：barlines → tab notes → std notation → symbols above/below
- 符号渲染使用音乐字体 (Bravura)
- 光标 (CaretPainter)：独立的可交互图形项

### 4.3 tuxguitar — 自定义 Canvas

布局计算 (TGLayout)：
- 两种布局模式：TGLayoutVertical（分页）、TGLayoutHorizontal（横向滚动）
- 基于 scale/fontScale 的缩放系统
- 精细的间距控制：20+ 个 spacing 参数
- 小节宽度根据内容动态计算（getDurationWidth）
- Track 间距、弦间距独立控制

渲染：
- TGMeasureImpl: 小节渲染实现
- TGBeatImpl: Beat 渲染（含 BeatGroup 分组）
- TGNoteImpl: 音符渲染
- TGVoiceImpl: 声部渲染
- painters/: 专门的绘制器（Clef、KeySignature、Note、Silence、Tempo、TripletFeel）
- 支持打印布局 (TGPrintLayout)

## 5. 连音/复杂节奏处理对比

### 5.1 tab-editor
- `tuplet` 字段：简单的数字（3=三连音）
- 无验证逻辑，不检查小节时值是否正确
- 不支持嵌套连音

### 5.2 powertabeditor
- `IrregularGrouping`: 独立对象，挂在 Voice 上
- 属性：position(起始位置), length(跨越的 Position 数), notesPlayed(实际音符数), notesPlayedOver(等价音符数)
- 例：三连音 = notesPlayed:3, notesPlayedOver:2
- `VoiceUtils::getDurationTime()`: 计算含连音的实际时值（返回 boost::rational 有理数，无精度损失）
- `VoiceUtils::getIrregularGroupsInRange()`: 查找范围内的连音组

### 5.3 tuxguitar
- `TGDivisionType`: 最完整的连音系统
- 预定义类型：1:1(正常), 3:2(三连音), 5:4, 6:4, 7:4, 9:8, 10:8, 11:8, 12:8, 13:8
- Duration 直接包含 DivisionType，不需要额外的分组对象
- `WHOLE_PRECISE_DURATION`: 通过 LCM 计算确保所有连音类型都能精确表示
- `splitPreciseDuration()`: 能将任意时长拆分为合法时值+连音组合
- `fromTime()`: 从 tick 数反推 Duration（含 threshold 容错处理各种舍入误差）

## 6. 对我们项目的设计启示

### 6.1 数据模型建议

采用 powertabeditor 的层级思路，但简化为 Web 友好的结构：

```typescript
// 核心层级: Score → Section → Measure → Beat → Note
interface Score {
  info: ScoreInfo;              // 标题、作者等
  tracks: Track[];              // 多轨（先只支持单轨吉他）
  measureHeaders: MeasureHeader[]; // 共享的小节元信息（借鉴 tuxguitar）
}

interface MeasureHeader {
  timeSignature: TimeSignature;  // 拍号
  tempo: number;                 // BPM
  repeatOpen: boolean;
  repeatClose: number;           // 0=不反复, >0=反复次数
  marker?: string;               // 段落标记
}

interface Track {
  name: string;
  tuning: number[];              // 各弦音高 [40,45,50,55,59,64] = 标准调弦
  measures: Measure[];
}

interface Measure {
  headerIndex: number;           // 指向 measureHeaders
  beats: Beat[];
  clef?: 'treble' | 'bass';
}

// Beat = 一个时间点上的所有音符（借鉴 tuxguitar 的 Beat 概念）
interface Beat {
  start: number;                 // 精确时间位置（相对于小节开头）
  duration: Duration;            // 时值（Beat 级别，非 Note 级别）
  notes: Note[];                 // 同时发声的音符
  rest: boolean;                 // 是否休止
  chord?: string;                // 和弦名称
  text?: string;                 // 文本标注
  stroke?: { direction: 'up' | 'down'; speed: number };
  effects: BeatEffect[];        // Beat 级别效果
}

interface Duration {
  value: 1 | 2 | 4 | 8 | 16 | 32 | 64;  // 全/二/四/八/十六/三十二/六十四
  dotted: boolean;
  doubleDotted: boolean;
  tuplet?: { enters: number; times: number };  // 连音：3:2=三连音
}

interface Note {
  string: number;                // 弦号 (1-6)
  fret: number;                  // 品位 (0-24)
  velocity: number;              // 力度
  tied: boolean;
  effects: NoteEffect[];        // Note 级别效果
}

// 效果系统：用 tagged union 而非 bitflags（TypeScript 友好）
type NoteEffect =
  | { type: 'hammer' }
  | { type: 'pulloff' }
  | { type: 'slide'; direction: 'up' | 'down' }
  | { type: 'bend'; points: BendPoint[] }
  | { type: 'vibrato' }
  | { type: 'harmonic'; kind: 'natural' | 'artificial' | 'tapped' }
  | { type: 'ghost' }
  | { type: 'muted' }
  | { type: 'palmMute' }
  | { type: 'letRing' }
  | { type: 'staccato' }
  | { type: 'trill'; fret: number }
  | { type: 'tremoloPicking' }
  | { type: 'tap' }
  | { type: 'slap' }
  | { type: 'pop' };

type BeatEffect =
  | { type: 'arpeggioUp' }
  | { type: 'arpeggioDown' }
  | { type: 'fermata' }
  | { type: 'acciaccatura' };
```

### 6.2 编辑系统建议

采用 Redux-like 的不可变状态 + Command 模式混合方案：

```
用户操作 → Command 对象 → Reducer 执行 → 新状态 → 重新渲染
                ↓
           UndoStack (Command 历史)
```

核心 Commands（借鉴 powertabeditor 的粒度）：
1. `SetNote(measureIdx, beatIdx, string, fret)` — 设置音符
2. `RemoveNote(measureIdx, beatIdx, string)` — 删除音符
3. `SetDuration(measureIdx, beatIdx, duration)` — 设置时值
4. `InsertBeat(measureIdx, afterBeatIdx)` — 插入 Beat
5. `RemoveBeat(measureIdx, beatIdx)` — 删除 Beat
6. `ToggleEffect(measureIdx, beatIdx, effect)` — 切换效果
7. `SetChord(measureIdx, beatIdx, chordName)` — 设置和弦
8. `SetTempo(headerIdx, bpm)` — 设置速度
9. `SetTimeSignature(headerIdx, timeSig)` — 设置拍号

光标系统（借鉴 powertabeditor 的 ScoreLocation）：
```typescript
interface Cursor {
  measureIndex: number;
  beatIndex: number;
  string: number;        // 当前弦
  voice: number;         // 当前声部（预留，初期只用 0）
}
```

### 6.3 渲染系统建议

采用 tab-editor 的 SVG 方案（Web 原生），但借鉴 powertabeditor 的布局精度：

1. 布局引擎（借鉴 LayoutInfo）：
   - 计算每个 Beat 的 x 坐标（基于时值的比例宽度，而非固定宽度）
   - 自动换行（按容器宽度）
   - 符号间距计算

2. 渲染层（SVG/Canvas）：
   - TAB 谱渲染（弦线 + 品位数字）
   - 符干/符尾/符杠渲染
   - 效果符号渲染
   - 和弦图渲染
   - 光标渲染

3. 交互层：
   - 点击定位（x → measureIndex + beatIndex + string）
   - 键盘导航
   - 拖拽选区

### 6.4 时间/节奏系统建议

借鉴 tuxguitar 的精确时间系统，但简化实现：

```typescript
// 精确时间计算（避免浮点误差）
const TICKS_PER_QUARTER = 960;  // 与 tuxguitar 一致

function durationToTicks(d: Duration): number {
  let ticks = (TICKS_PER_QUARTER * 4) / d.value;  // 基础时值
  if (d.dotted) ticks *= 1.5;
  if (d.doubleDotted) ticks *= 1.75;
  if (d.tuplet) ticks = ticks * d.tuplet.times / d.tuplet.enters;
  return Math.round(ticks);
}

// 小节时值验证（借鉴 tuxguitar 的 getMeasureErrors）
function validateMeasure(measure: Measure, header: MeasureHeader): MeasureError[] {
  const expectedTicks = header.timeSignature.numerator *
    (TICKS_PER_QUARTER * 4 / header.timeSignature.denominator);
  const actualTicks = measure.beats.reduce((sum, b) => sum + durationToTicks(b.duration), 0);
  // ...
}
```

### 6.5 与现有 TMD/AlphaTex 管线的集成

当前项目已有 TMD → AST → AlphaTex → alphaTab 的管线。TAB 编辑器需要：

1. 编辑器内部状态 ↔ TMD AST 双向转换
2. 编辑器状态 → AlphaTex 生成 → alphaTab 渲染（利用现有管线）
3. 或者：编辑器直接操作 alphaTab 的 Score 对象（更高效，跳过文本序列化）

推荐路径：先用方案 2（复用现有管线），后期优化为方案 3。

## 7. 各项目值得借鉴的具体设计

### 7.1 从 tab-editor 借鉴
- ✅ React 组件化渲染思路
- ✅ 键盘快捷键方案（数字输入品位、方向键导航）
- ✅ 简洁的状态管理（Redux reducer 模式）
- ✅ 两位数品位输入逻辑（先按1再按2=12品）
- ❌ 不借鉴：固定宽度布局、无时值验证

### 7.2 从 powertabeditor 借鉴
- ✅ Score → System → Staff → Voice → Position → Note 层级
- ✅ ScoreLocation 5 维定位系统
- ✅ Command 模式 + UndoStack
- ✅ LayoutInfo 精确布局计算
- ✅ SymbolGroup 连续符号合并渲染
- ✅ BeamGroup 符杠分组
- ✅ IrregularGrouping 连音处理
- ✅ Position.SimpleProperty bitflags 高效属性存储
- ❌ 不借鉴：Qt 依赖、C++ 特有模式

### 7.3 从 tuxguitar 借鉴
- ✅ MeasureHeader 共享模式（多轨一致性）
- ✅ Beat 时间戳定位（精确回放）
- ✅ DivisionType 连音系统（支持 3:2 到 13:8）
- ✅ preciseStart/preciseTime 双精度时间
- ✅ NoteEffect 互斥逻辑（设置效果时自动清除冲突效果）
- ✅ MeasureManager 的 autoCompleteSilences（自动填充休止符）
- ✅ validateDuration + fixVoice（时值验证和自动修复）
- ✅ splitPreciseDuration（时长拆分为合法时值组合）
- ❌ 不借鉴：Java/SWT 特有模式、过度抽象的 Factory 模式

## 8. 实现优先级建议

### Phase 1: 基础编辑（MVP）
- 数据模型定义（Score/Measure/Beat/Note）
- 光标系统（键盘导航 + 点击定位）
- 基础编辑（输入品位、设置时值、插入/删除）
- SVG TAB 谱渲染（弦线 + 数字 + 基础符干）
- Undo/Redo

### Phase 2: 节奏增强
- 附点、连音支持
- 小节时值验证 + 自动填充休止符
- 符杠(beam)渲染
- 和弦标注

### Phase 3: 效果系统
- 常用效果：hammer-on, pull-off, slide, bend, vibrato
- 效果符号渲染
- 效果互斥逻辑

### Phase 4: 高级功能
- 多声部
- 标准记谱（五线谱）
- 文件导入/导出
- 打印布局
