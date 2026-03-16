/**
 * AlphaTab Score Model 后处理
 *
 * 在 scoreLoaded 回调里对 score model 做的所有修改，
 * 从 ScorePane.tsx 解耦出来，方便测试和维护。
 *
 * 职责:
 *   1. x 品位标记 — 和弦指法上的 note 设 isDead=true 显示 x
 *   2. let ring 注入 — 所有非 dead/palm-mute 的 note 设 isLetRing=true
 *   3. 和弦图设置 — firstFret 自动计算、showFingering、显示位置
 *   4. loadMidiForScore patch — MIDI 生成时临时恢复 isDead=false
 *
 * ── 关键发现（探索过程中踩过的坑） ──────────────────────────
 *
 * 1. note.string 编号方向与 chord.strings 相反:
 *    - chord.strings[0] = 1弦(高E), chord.strings[5] = 6弦(低E)
 *    - note.string = 1 = 6弦(低E), note.string = 6 = 1弦(高E)
 *    - 映射公式: chord.strings[si] 对应 note.string = numStrings - si
 *    - 这是因为 AlphaTex 里弦号从低到高(1=低E)，但 \chord 指法从高到低
 *
 * 2. AlphaTab 内部时序 (_internalRenderTracks):
 *    scoreLoaded → loadMidiForScore(同步) → render(序列化到 Worker)
 *    - scoreLoaded 里改 model → MIDI 和渲染都能看到
 *    - 渲染在 Web Worker 里，score 通过 JsonConverter.scoreToJsObject 序列化
 *    - 所以 isDead 在 scoreLoaded 里设置后，Worker 渲染时能读到
 *
 * 3. isDead=true 的副作用:
 *    - 渲染: TAB 谱上显示 x 而不是品位数字 ✓
 *    - MIDI: dead note 不发声（静音）✗ — 需要 monkey-patch loadMidiForScore
 *    - 解决: MIDI 生成前临时恢复 isDead=false + 原始 fret，生成后改回
 *
 * 4. let ring 必须在 x 标记之前或同时设置:
 *    - 被标记为 x 的 note 也需要 isLetRing=true（MIDI 播放时恢复了正常 fret）
 *    - 之前的 bug: x 标记后 continue 跳过了 isLetRing，导致余音效果丢失
 *
 * 5. 为什么不用 AlphaTex {lr} 语法:
 *    - 每个音符都要加 {lr}，文本膨胀严重
 *    - scoreLoaded 回调直接改 model 更干净
 *
 * 6. 为什么不用 SustainPedalMarker:
 *    - AlphaTab 的 SustainPedalMarker 构造函数未导出为公开 API
 *    - 运行时报 "not a constructor" 错误
 *
 * 7. 之前失败的 x 标记方案:
 *    - {slashed} 属性 — 不是用户要的效果（斜杠音符头，不是 x）
 *    - DOM 替换 — 渲染在 Worker 里，坐标匹配不上
 *    - renderFinished 里改 isDead — MIDI 已经生成了，来不及
 *
 * 8. x 标记开关（enableXMarks）:
 *    - 可以在运行时切换，不需要重新加载 tex
 *    - 关闭时: revertXMarks 恢复 _origFret → applyLetRingOnly 只设余音
 *    - 开启时: applyXMarksAndLetRing 重新标记
 *    - 切换后调用 api.render() 触发重新序列化到 Worker
 *    - 状态通过 localStorage('lyrichord-x-marks') 持久化
 *
 * 9. chord.firstFret 自动计算:
 *    - AlphaTab \chord 传的是绝对品位，渲染时 fret -= (firstFret-1)
 *    - 和弦图网格只有 5 格，高把位和弦必须设 firstFret
 *    - firstFret=1 → 画琴枕粗线，不标品位号
 *    - firstFret>1 → 不画琴枕，左侧标起始品位号
 *
 * 10. \chord 参数顺序:
 *     - AlphaTex \chord 的 frets 参数: 从1弦(高E)到6弦(低E)
 *     - 我们的 TMD define [C]: { frets: "x 3 2 0 1 0" } 也是1弦→6弦
 *     - alphatex.ts 生成时需要 reverse 数组（因为内部存储是6弦→1弦）
 */

// ── 类型（AlphaTab score model 是 any，这里定义最小接口） ──

interface ATNote {
  isDead: boolean;
  isPalmMute: boolean;
  isLetRing: boolean;
  fret: number;
  string: number;  // AlphaTab 内部编号: 1=低E(6弦) ... 6=高E(1弦)
  _origFret?: number;
}

interface ATBeat {
  chordId: string | null;
  notes: ATNote[];
}

interface ATVoice { beats: ATBeat[] }
interface ATBar { voices: ATVoice[] }

interface ATChord {
  strings: number[];  // [0]=1弦(高E) ... [5]=6弦(低E), -1=不弹
  firstFret: number;
  showFingering: boolean;
  showDiagram: boolean;
}

interface ATStaff {
  bars: ATBar[];
  chords: Map<string, ATChord> | null;
  tuning: number[];
}

interface ATTrack { staves: ATStaff[] }

interface ATScore {
  tracks: ATTrack[];
  stylesheet?: {
    globalDisplayChordDiagramsOnTop: boolean;
    globalDisplayChordDiagramsInScore: boolean;
  };
}

// ============================================================
// scoreLoaded 后处理入口
// ============================================================

export interface PostProcessOptions {
  enableXMarks?: boolean;  // 默认 true
}

export function postProcessScore(score: ATScore, opts?: PostProcessOptions): void {
  const enableX = opts?.enableXMarks !== false;

  applyChordDiagramSettings(score);

  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const chordFretMap = buildChordFretMap(staff);
      if (enableX) {
        applyXMarksAndLetRing(staff, chordFretMap);
      } else {
        revertXMarks(staff);
        applyLetRingOnly(staff);
      }
      applyChordFirstFret(staff);
    }
  }
}

// ============================================================
// x 品位标记 + let ring
// ============================================================

/**
 * 构建和弦指法查找表
 *
 * chord.strings: [0]=1弦(高E) [1]=2弦 ... [5]=6弦(低E)
 * note.string:   1=6弦(低E) ... 6=1弦(高E)
 * 映射: chord.strings[si] 对应 note.string = numStrings - si
 */
function buildChordFretMap(staff: ATStaff): Map<string, Map<number, number>> {
  const map = new Map<string, Map<number, number>>();
  if (!staff.chords) return map;

  const numStrings = staff.tuning?.length ?? 6;
  for (const [chordId, chord] of staff.chords) {
    if (!chord?.strings) continue;
    const stringMap = new Map<number, number>();
    for (let si = 0; si < chord.strings.length; si++) {
      const fret = chord.strings[si];
      if (fret >= 0) {
        stringMap.set(numStrings - si, fret);
      }
    }
    map.set(chordId, stringMap);
  }
  return map;
}

/**
 * 遍历所有 note:
 *   - 在当前和弦指法上 → isDead=true (TAB 显示 x), 保存 _origFret
 *   - 不在和弦上 → isLetRing=true (余音效果)
 */
function applyXMarksAndLetRing(
  staff: ATStaff,
  chordFretMap: Map<string, Map<number, number>>,
): void {
  let currentChordId: string | null = null;

  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.chordId != null && beat.chordId !== '') {
          currentChordId = beat.chordId;
        }
        const chordFrets = currentChordId ? chordFretMap.get(currentChordId) : null;

        for (const note of beat.notes) {
          if (note.isDead || note.isPalmMute) continue;

          if (chordFrets) {
            const expectedFret = chordFrets.get(note.string);
            if (expectedFret != null && note.fret === expectedFret) {
              note._origFret = note.fret;
              note.isLetRing = true;
              note.isDead = true;
              note.fret = 0;
              continue;
            }
          }
          note.isLetRing = true;
        }
      }
    }
  }
}

/**
 * 关闭 x 模式时：恢复之前被标记为 isDead 的 note
 */
function revertXMarks(staff: ATStaff): void {
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          if (note.isDead && note._origFret != null) {
            note.isDead = false;
            note.fret = note._origFret;
            delete note._origFret;
          }
        }
      }
    }
  }
}

/**
 * 只设 let ring，不做 x 标记
 */
function applyLetRingOnly(staff: ATStaff): void {
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          if (!note.isDead && !note.isPalmMute) {
            note.isLetRing = true;
          }
        }
      }
    }
  }
}

// ============================================================
// 和弦图设置
// ============================================================

function applyChordDiagramSettings(score: ATScore): void {
  if (score.stylesheet) {
    score.stylesheet.globalDisplayChordDiagramsOnTop = true;
    score.stylesheet.globalDisplayChordDiagramsInScore = true;
  }
}

/**
 * 高把位和弦 firstFret 自动计算 + showFingering
 *
 * minFret <= 4 → firstFret=1 (琴枕粗线)
 * minFret >= 5 → firstFret=minFret (左侧标品位号)
 */
function applyChordFirstFret(staff: ATStaff): void {
  if (!staff.chords) return;
  for (const [, chord] of staff.chords) {
    if (!chord?.strings) continue;
    const played = chord.strings.filter(f => f > 0);
    if (played.length === 0) continue;
    const minFret = Math.min(...played);
    if (minFret >= 5) {
      chord.firstFret = minFret;
    }
    chord.showFingering = true;
  }
}

// ============================================================
// loadMidiForScore monkey-patch
// ============================================================

/**
 * Patch loadMidiForScore: MIDI 生成前临时恢复 isDead=false + 原始 fret，
 * 生成后改回 isDead=true + fret=0。
 * 这样渲染显示 x，播放音色正常。
 */
export function patchLoadMidiForScore(api: any, scoreRef: { current: any }): void {
  const orig = api.loadMidiForScore.bind(api);
  api.loadMidiForScore = function () {
    const score = scoreRef.current;
    const deadNotes: ATNote[] = [];
    if (score) {
      for (const track of score.tracks) {
        for (const staff of (track as ATTrack).staves) {
          for (const bar of staff.bars) {
            for (const voice of bar.voices) {
              for (const beat of voice.beats) {
                for (const note of beat.notes) {
                  if (note.isDead && note._origFret != null) {
                    deadNotes.push(note);
                    note.isDead = false;
                    note.fret = note._origFret;
                  }
                }
              }
            }
          }
        }
      }
    }
    orig();
    for (const note of deadNotes) {
      note.isDead = true;
      note.fret = 0;
    }
  };
}
