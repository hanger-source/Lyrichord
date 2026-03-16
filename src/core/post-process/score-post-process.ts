/**
 * AlphaTab Score Model 后处理
 *
 * 在 scoreLoaded 回调里对 score model 做的所有修改，
 * 从 ScorePane.tsx 解耦出来，方便测试和维护。
 *
 * 职责:
 *   1. x 品位标记 — 和弦指法上的 note 设 isDead=true 显示 x
 *   2. let ring 注入 — 非 dead/palm-mute 的 note 设 isLetRing=true
 *   3. 和弦图设置 — firstFret 自动计算、showFingering、显示位置
 *   4. loadMidiForScore patch — MIDI 生成时临时恢复 isDead=false
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
