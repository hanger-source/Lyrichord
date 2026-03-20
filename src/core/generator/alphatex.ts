/**
 * AlphaTex 生成器 v7
 *
 * Song → AlphaTexOutput
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 核心数据流                                                   │
 * │                                                             │
 * │  TMD Text ──scan()──▶ Token[]                               │
 * │           ──buildSong()──▶ Song { masterBars, bars, ... }   │
 * │           ──generate()──▶ AlphaTexOutput { tex, measures }  │
 * │                                                             │
 * │  AlphaTex 文本最终传给 AlphaTab 的 api.tex(tex) 进行渲染/播放  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 两种小节模式:
 *   1. TEX 直通: beat._rawTex 存在 → 直接输出原始 AlphaTex beat 文本
 *      用于 TAB 编辑器手写的精确音符（如前奏指弹）
 *   2. 节奏型展开: 用 chordSlots + rhythmPattern 生成 beat 序列
 *      用于弹唱段落（和弦 + 节奏型自动展开）
 *
 * AlphaTex 语法参考:
 *   音符: fret.string (如 3.6 = 6弦3品)
 *   多音: (3.6 2.5 0.4)
 *   时值: .4 = 四分音符, .8 = 八分, .16 = 十六分
 *   Beat 属性: {ad 60} = brush down, {au 60} = brush up, {ds} = dead stroke
 *   Note 属性: {lr} = let ring, {pm} = palm mute, {x} = dead note
 *   和弦标记: {ch "Am"} → 谱面显示和弦名
 *   段落标记: \section "前奏" → 谱面显示段落名
 *
 * 歌词: 使用 AlphaTab 的 \lyrics staff-level 指令
 *   格式: \lyrics "word1 word2 - word3 ..."
 *   空格分隔对应每个 beat，"-" 表示延续
 *
 * 延音效果:
 *   let ring 不在此处生成（避免 AlphaTex 文本膨胀），
 *   而是在 ScorePane.tsx 的 scoreLoaded 回调里统一注入 note.isLetRing = true。
 *   谱面上的 let ring 虚线标记通过 effectLetRing: false 隐藏。
 */
import type {
  Song, Bar, Beat, RhythmPattern, GuitarFrets,
  AlphaTexOutput, GeneratedMeasure,
  Note, RhythmSlot,
} from '../types';
import {
  durationToAlphaTex, durationToBeats, beatsToDuration,
} from '../types';
import { resolveChord } from '../chord/resolver';
import { notesToAlphaTex } from '../chord/voicing';

export function generate(song: Song): AlphaTexOutput {
  const measures: GeneratedMeasure[] = [];
  const headerLines: string[] = [];
  const barLines: string[] = [];

  // ---- Header metadata ----
  if (song.meta.title) headerLines.push(`\\title "${song.meta.title}"`);
  if (song.meta.artist) headerLines.push(`\\subtitle "${song.meta.artist}"`);
  headerLines.push(`\\tempo ${song.meta.tempo}`);
  headerLines.push(`\\instrument acousticguitarsteel`);
  if (song.meta.capo > 0) headerLines.push(`\\capo ${song.meta.capo}`);
  const ts = song.meta.timeSignature;
  headerLines.push(`\\ts ${ts.numerator} ${ts.denominator}`);

  let lastChordFrets: GuitarFrets | null = null;
  let lastChordId: string | null = null;

  // ---- 收集所有歌词用于 \lyrics 指令 ----
  const allLyricWords: string[] = [];
  const allLyric2Words: string[] = [];

  for (let i = 0; i < song.masterBars.length; i++) {
    const mb = song.masterBars[i];
    const bar = song.bars[i];
    if (!bar) continue;

    // 检查是否是 tex 直通模式
    const isTexMode = bar.beats.some(b => (b as any)._rawTex);

    // Section 标记
    const sectionTex = mb.section ? `\\section "${mb.section.name}" ` : '';

    let measureTex: string;
    let measureLyrics = '';
    let measureLyrics2 = '';

    if (isTexMode) {
      // TEX 直通模式
      measureTex = generateTexPassthrough(bar, song, lastChordId, lastChordFrets);
      // 更新 lastChord
      for (const beat of bar.beats) {
        if (beat.chordId) {
          lastChordId = beat.chordId;
          const frets = resolveFrets(beat.chordId, song);
          if (frets) lastChordFrets = frets;
        }
      }
    } else {
      // ── 节奏型区间展开模式 ──
      //
      // 核心概念：@R1 标记的是一个"节奏型区间"的起始，不是每个和弦独立的节奏型。
      // 一个区间内可以有多个和弦切换，节奏型在区间内完整展开一遍。
      //
      // 例: | G@R1 D A7@R1 . |
      //   区间1: G+D 共 2 拍，R1 完整展开，和弦在中间切换
      //   区间2: A7 共 2 拍，R1 完整展开
      //
      // 分组规则：
      //   有 rhythmId 的 beat → 开始新区间
      //   没有 rhythmId 的 beat → 继承前面的区间（区间内和弦切换）
      //
      const defaultRhythmId = mb.rhythmId ?? null;
      const beatsPerMeasure = ts.numerator * (4 / ts.denominator);

      // ---- 按区间分组 beat ----
      interface RhythmRegion {
        rhythmId: string | null;
        beats: Beat[];
        totalBeats: number;
      }

      const regions: RhythmRegion[] = [];
      // 保存进入本小节前的 lastChordId，用于区间生成时的 ch 标记判断
      const prevChordBeforeBar = lastChordId;

      for (const beat of bar.beats) {
        const rid = beat.rhythmId ?? null;
        if (rid) {
          // 显式 @R1 标记 → 开始新区间
          regions.push({ rhythmId: rid, beats: [beat], totalBeats: durationToBeats(beat.duration) });
        } else if (regions.length > 0 && regions[regions.length - 1].rhythmId) {
          // 没有 @R1 且前面有区间 → 继承，属于同一区间内的和弦切换
          const last = regions[regions.length - 1];
          last.beats.push(beat);
          last.totalBeats += durationToBeats(beat.duration);
        } else {
          // 没有节奏型的 beat（也没有前面的区间可继承）
          // fallback 到段落级 rhythmId 或无节奏型
          const fallbackRid = defaultRhythmId;
          if (fallbackRid) {
            regions.push({ rhythmId: fallbackRid, beats: [beat], totalBeats: durationToBeats(beat.duration) });
          } else {
            regions.push({ rhythmId: null, beats: [beat], totalBeats: durationToBeats(beat.duration) });
          }
        }

        // 更新 lastChord 追踪
        if (beat.chordId) {
          lastChordId = beat.chordId;
          const f = resolveFrets(beat.chordId, song);
          if (f) lastChordFrets = f;
        }
      }

      // ---- 逐区间生成 AlphaTex ----
      const regionParts: string[] = [];
      // 用进入本小节前的 prevChordId 开始追踪
      let regionPrevChord = prevChordBeforeBar;

      for (const region of regions) {
        const rid = region.rhythmId;
        const rhythm = rid ? song.rhythmLibrary.get(rid) ?? null : null;

        if (rhythm && rhythm.slots.length > 0) {
          const regionBar: Bar = { masterBarIndex: bar.masterBarIndex, beats: region.beats };
          const result = generateRegionWithRhythm(
            rhythm, regionBar, song, region.totalBeats, lastChordFrets, regionPrevChord,
          );
          regionParts.push(result.tex);
          regionPrevChord = result.lastChordId;
        } else {
          // 无节奏型 → fallback 逐 beat
          for (const beat of region.beats) {
            const frets = beat.chordId ? resolveFrets(beat.chordId, song) : lastChordFrets;
            if (frets) {
              regionParts.push(generateFallbackSegment(frets, durationToBeats(beat.duration), beat.chordId ?? null));
            } else {
              const dur = durationToAlphaTex(beat.duration);
              const props = beat.chordId ? `{ch "${beat.chordId}"}` : '';
              regionParts.push(props ? `r.${dur} ${props}` : `r.${dur}`);
            }
          }
        }
      }

      measureTex = regionParts.join(' ');

      // 收集歌词
      for (const beat of bar.beats) {
        if (beat.lyrics && beat.lyrics !== '~') {
          measureLyrics += beat.lyrics;
        }
        const w2 = (beat as any)._lyrics2;
        if (w2 && w2 !== '~') {
          measureLyrics2 += w2;
        }
      }
    }

    barLines.push(sectionTex + measureTex + ' |');

    measures.push({
      notes: measureTex,
      lyrics: measureLyrics || undefined,
    });

    // 收集歌词 words (每个 beat 对应一个 word)
    if (!isTexMode) {
      for (const beat of bar.beats) {
        const ly = beat.lyrics;
        if (ly && ly !== '~') {
          allLyricWords.push(ly);
        } else {
          allLyricWords.push('-');
        }
        const w2 = (beat as any)._lyrics2;
        if (w2 && w2 !== '~') {
          allLyric2Words.push(w2);
        } else {
          allLyric2Words.push('-');
        }
      }
    } else {
      // tex 模式的 beat 不产生歌词
      for (const _beat of bar.beats) {
        allLyricWords.push('-');
        allLyric2Words.push('-');
      }
    }
  }

  // ---- 组装最终 AlphaTex ----
  const lines = [...headerLines];

  // ── \chord 指令 — 和弦指法图 ────────────────────────────
  // 收集所有用到的和弦，用 \chord 语法定义指法数据。
  // AlphaTab 会在谱面开头渲染指法图（showDiagram=true）。
  // 格式: \chord "Am" 1弦 2弦 3弦 4弦 5弦 6弦
  //   AlphaTab 参数顺序: 1弦(高E) → 6弦(低E)，与 GuitarFrets 相反
  //   -1=不弹, 0=空弦, N=品位(绝对)
  const chordsSeen = new Set<string>();
  for (const bar of song.bars) {
    if (!bar) continue;
    for (const beat of bar.beats) {
      if (beat.chordId && !chordsSeen.has(beat.chordId)) {
        chordsSeen.add(beat.chordId);
        const frets = resolveFrets(beat.chordId, song);
        if (frets) {
          // AlphaTab \chord 参数顺序: 1弦(高E) → 6弦(低E)
          // GuitarFrets 索引顺序: [0]=6弦(低E) → [5]=1弦(高E)
          // 所以需要反转数组
          const reversed = [...frets].reverse();
          const fretsStr = reversed.map(f => f < 0 ? -1 : f).join(' ');
          lines.push(`\\chord "${beat.chordId}" ${fretsStr}`);
        }
      }
    }
  }

  // 歌词指令 (如果有非空歌词)
  const hasLyrics = allLyricWords.some(w => w !== '-');
  if (hasLyrics) {
    const lyricsStr = allLyricWords.join(' ');
    lines.push(`\\lyrics "${lyricsStr}"`);
  }

  lines.push('.');  // 分隔符

  lines.push(...barLines);

  return { tex: lines.join('\n'), measures };
}


// ============================================================
// 节奏型区间展开
// ============================================================

/**
 * 在一个节奏型区间内完整展开节奏型。
 *
 * 区间 = 从一个 @R1 标记到下一个 @R1 标记之间的所有 beat。
 * 节奏型完整走一遍，slot 时值 = 区间总拍数 / slots.length。
 * 区间内多个和弦在对应 slot 位置切换。
 *
 * 例: R1 = D-DU-DUU (8 slot), 区间 = G+D 共 2 拍
 *   每 slot = 2/8 = 0.25 拍 (十六分音符)
 *   G 占 1 拍 = slot 0-3, D 占 1 拍 = slot 4-7
 */
function generateRegionWithRhythm(
  rhythm: RhythmPattern,
  regionBar: Bar,
  song: Song,
  regionTotalBeats: number,
  inheritedFrets: GuitarFrets | null,
  prevChordId: string | null,
): { tex: string; lastChordId: string | null } {
  const slotCount = rhythm.slots.length;
  const slotDur = regionTotalBeats / slotCount; // 每 slot 的拍数
  const durVal = beatsToDuration(slotDur);
  const durStr = durationToAlphaTex(durVal);

  // 构建 slot → 和弦映射
  interface ChordSpan {
    chordId: string | null;
    frets: GuitarFrets | null;
    startBeat: number;
    endBeat: number;
  }

  const spans: ChordSpan[] = [];
  let pos = 0;
  for (const beat of regionBar.beats) {
    const dur = durationToBeats(beat.duration);
    const frets = beat.chordId ? resolveFrets(beat.chordId, song) : null;
    spans.push({
      chordId: beat.chordId ?? null,
      frets: frets ?? inheritedFrets,
      startBeat: pos,
      endBeat: pos + dur,
    });
    pos += dur;
  }

  function chordAtSlot(si: number): ChordSpan | null {
    const slotStart = si * slotDur;
    for (const sp of spans) {
      if (slotStart >= sp.startBeat - 0.01 && slotStart < sp.endBeat - 0.01) {
        return sp;
      }
    }
    return spans.length > 0 ? spans[spans.length - 1] : null;
  }

  const parts: string[] = [];
  let lastNotes: Note[] | null = null;

  for (let si = 0; si < slotCount; si++) {
    const slot = rhythm.slots[si];
    const span = chordAtSlot(si);
    const cid = span?.chordId ?? null;
    const frets = span?.frets ?? inheritedFrets;

    const props: string[] = [];
    if (cid && cid !== prevChordId) {
      props.push(`ch "${cid}"`);
    }
    if (cid) prevChordId = cid;

    const isSustain = slot.kind === 'strum' && slot.action === 'sustain';

    if (!frets) {
      const propsStr = wrapProps(props);
      parts.push(propsStr ? `r.${durStr} ${propsStr}` : `r.${durStr}`);
      continue;
    }

    if (isSustain && lastNotes && lastNotes.length > 0) {
      // sustain → tied note: 同音符 + {t} tie + {lr} let-ring
      const noteTex = notesToAlphaTex(lastNotes, '{t lr}');
      const propsStr = wrapProps(props);
      parts.push(propsStr
        ? `${noteTex}.${durStr} ${propsStr}`
        : `${noteTex}.${durStr}`);
    } else {
      const { notes, brush } = slotToNotes(slot, frets);
      if (notes.length === 0) {
        const propsStr = wrapProps(props);
        parts.push(propsStr ? `r.${durStr} ${propsStr}` : `r.${durStr}`);
      } else {
        const noteEffect = (slot.kind === 'strum' && slot.action !== 'mute') ? '{lr}' : undefined;
        const noteTex = notesToAlphaTex(notes, noteEffect);
        const allProps = brush
          ? wrapProps([brush, ...props])
          : wrapProps(props);
        parts.push(allProps
          ? `${noteTex}.${durStr} ${allProps}`
          : `${noteTex}.${durStr}`);
        lastNotes = notes;
      }
    }
  }

  return { tex: parts.join(' '), lastChordId: prevChordId };
}


// ============================================================
// TEX 直通模式
// ============================================================

/**
 * 直接输出 bar 中的 _rawTex beat 文本
 * 和弦标记用 {ch "X"} 属性
 */
function generateTexPassthrough(
  bar: Bar, _song: Song,
  _inheritedChordId: string | null,
  _inheritedFrets: GuitarFrets | null,
): string {
  const parts: string[] = [];

  for (const beat of bar.beats) {
    const rawTex = (beat as any)._rawTex as string | undefined;
    if (!rawTex) continue;

    // 从 _rawTex 中提取已有的 {props} 块，分离出纯 beat 文本和属性
    const propsMatch = rawTex.match(/^(.*?)\s*\{([^}]*)\}\s*$/);
    let beatText: string;
    const existingProps: string[] = [];

    if (propsMatch) {
      beatText = propsMatch[1].trim();
      existingProps.push(propsMatch[2].trim());
    } else {
      beatText = rawTex;
    }

    // 添加和弦属性
    if (beat.chordId) {
      existingProps.push(`ch "${beat.chordId}"`);
    }

    if (existingProps.length > 0) {
      parts.push(`${beatText} {${existingProps.join(' ')}}`);
    } else {
      parts.push(beatText);
    }
  }

  return parts.join(' ');
}


function resolveFrets(chordId: string, song: Song): GuitarFrets | null {
  const fromLib = song.chordLibrary.get(chordId);
  if (fromLib) return fromLib.frets;
  const resolved = resolveChord(chordId);
  return resolved ? resolved.frets : null;
}


// ============================================================
// Slot → Notes
// ============================================================

/**
 * Slot → Notes 转换
 *
 * 将节奏型的单个 slot 转换为 AlphaTex 音符列表。
 *
 * slot.kind:
 *   'pluck' → 拨弦: target='root' 只弹根音, 否则按 strings[] 指定弦
 *   'strum' → 扫弦:
 *     action='down'    → 下扫 {ad 60}
 *     action='up'      → 上扫 {au 60}
 *     action='mute'    → 闷音 {ds} (dead stroke)
 *     action='sustain' → 延续前一个音（合并到前一个 event 的时值里）
 *
 * frets: GuitarFrets = number[6]，索引 0=1弦(高E) 5=6弦(低E)
 * 弦号约定: string 6=低E, string 1=高E (AlphaTab 标准)
 * 索引转换: idx = 6 - string
 */
function slotToNotes(
  slot: RhythmSlot,
  frets: GuitarFrets,
): { notes: Note[]; brush?: string } {
  if (slot.kind === 'pluck') {
    if (slot.target === 'root') {
      return { notes: [findRootNote(frets)] };
    }
    const notes: Note[] = [];
    for (const s of slot.strings) {
      const idx = 6 - s;
      if (idx >= 0 && idx < frets.length && frets[idx] >= 0) {
        notes.push({ string: s, fret: frets[idx] });
      }
    }
    return { notes: notes.length > 0 ? notes : [findRootNote(frets)] };
  }

  if (slot.kind === 'strum') {
    if (slot.action === 'sustain') return { notes: [] };
    // fromRoot：从和弦根音弦扫到1弦
    // 部分弦：只取指定弦
    // 省略 strings + 无 fromRoot = 全弦
    let targetNotes: Note[];
    if (slot.fromRoot) {
      // 找根音弦号（最低有效弦）
      const rootNote = findRootNote(frets);
      targetNotes = [];
      for (let s = rootNote.string; s >= 1; s--) {
        const idx = 6 - s;
        if (idx >= 0 && idx < frets.length && frets[idx] >= 0) {
          targetNotes.push({ string: s, fret: frets[idx] });
        }
      }
      if (targetNotes.length === 0) targetNotes = getAllPlayable(frets);
    } else if (slot.strings && slot.strings.length > 0) {
      targetNotes = slot.strings
        .map(s => { const idx = 6 - s; return idx >= 0 && idx < frets.length && frets[idx] >= 0 ? { string: s, fret: frets[idx] } as Note : null; })
        .filter((n): n is Note => n !== null);
    } else {
      targetNotes = getAllPlayable(frets);
    }
    // brush duration (弦间延迟): 下扫 60ms, 上扫 50ms
    // 上扫比下扫快 10ms — 模拟真实手腕回弹 vs 重力顺势的速度差异
    // 调参历史: 默认→120ms(太慢)→40ms(太像拨)→60/50ms(当前)
    // 注意: 与 tab-tmd-gen.ts 的 brush duration 保持同步
    if (slot.action === 'down') return { notes: targetNotes, brush: 'ad 60' };
    if (slot.action === 'up') return { notes: targetNotes, brush: 'au 50' };
    // ds (dead stroke) 不接受 duration 参数 — AlphaTab 会报 AT220
    if (slot.action === 'mute') return { notes: targetNotes, brush: 'ds' };
    return { notes: targetNotes };
  }

  return { notes: [findRootNote(frets)] };
}

// ============================================================
// 工具函数
// ============================================================

function findRootNote(frets: GuitarFrets): Note {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return { string: 6 - i, fret: frets[i] };
  }
  return { string: 6, fret: 0 };
}

function getAllPlayable(frets: GuitarFrets): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) notes.push({ string: 6 - i, fret: frets[i] });
  }
  return notes;
}

function wrapProps(props: string[]): string {
  return props.length > 0 ? `{${props.join(' ')}}` : '';
}


// ============================================================
// 无节奏型 fallback
// ============================================================

/**
 * 无节奏型时的 fallback — 简单根音
 */
function generateFallbackSegment(
  frets: GuitarFrets,
  chordBeats: number,
  chordId: string | null,
): string {
  const dur = beatsToDuration(chordBeats);
  const durStr = durationToAlphaTex(dur);
  const root = findRootNote(frets);
  const noteTex = notesToAlphaTex([root]);
  const props: string[] = [];
  if (chordId) props.push(`ch "${chordId}"`);
  const propsStr = wrapProps(props);
  return propsStr ? `${noteTex}.${durStr} ${propsStr}` : `${noteTex}.${durStr}`;
}
