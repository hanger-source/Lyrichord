/**
 * AST 构建器 v3 — 产出 Song 模型
 *
 * Token[] → Song { masterBars, bars, rhythmLibrary, chordLibrary }
 */
import type {
  Token, Song, SongMeta, MasterBar, Bar, Beat,
  RhythmPattern, RhythmType, TimeSignature,
  ChordDefinition, GuitarFrets,
} from '../types';
import { beatsToDuration } from '../types';
import { parsePattern } from '../rhythm/pattern-parser';

export interface BuildResult {
  song: Song;
  warnings: BuildWarning[];
}

export interface BuildWarning {
  message: string;
  line: number;
}

export function buildSong(tokens: Token[]): BuildResult {
  const warnings: BuildWarning[] = [];
  const meta: SongMeta = {
    tempo: 72,
    timeSignature: { numerator: 4, denominator: 4 },
    capo: 0,
  };
  const rhythmLibrary = new Map<string, RhythmPattern>();
  const chordLibrary = new Map<string, ChordDefinition>();
  const masterBars: MasterBar[] = [];
  const bars: Bar[] = [];

  let pendingMetaKey: string | null = null;
  let currentSection: string | null = null;
  let currentRhythmId: string | null = null;
  let inMeasure = false;
  let measureEvents: MeasureEvent[] = [];
  let lastFlushedSection: string | null = null;

  for (let ti = 0; ti < tokens.length; ti++) {
    const t = tokens[ti];
    switch (t.type) {
      case 'META_KEY':
        pendingMetaKey = t.value.toLowerCase();
        break;
      case 'META_VALUE':
        if (pendingMetaKey) { applyMeta(meta, pendingMetaKey, t.value); pendingMetaKey = null; }
        break;
      case 'RHYTHM_DEF':
        parseRhythmDef(t.value, t.line, rhythmLibrary, warnings);
        break;
      case 'CHORD_DEF':
        parseChordDef(t.value, t.line, chordLibrary, warnings);
        break;
      case 'SECTION':
        flushMeasure();
        currentSection = t.value;
        break;
      case 'RHYTHM_REF':
        currentRhythmId = t.value.replace(/^@/, '').trim();
        break;
      case 'BAR_LINE':
        if (inMeasure) flushMeasure();
        inMeasure = true;
        break;
      case 'CHORD': {
        let beats: number | null = null;
        if (ti + 1 < tokens.length && tokens[ti + 1].type === 'CHORD_BEATS') {
          beats = parseFloat(tokens[ti + 1].value);
          ti++;
        }
        measureEvents.push({ type: 'chord', chord: t.value, beats, lyrics: '' });
        break;
      }
      case 'LYRICS':
        if (measureEvents.length > 0) measureEvents[measureEvents.length - 1].lyrics += t.value;
        break;
      case 'REST':
        measureEvents.push({ type: 'sustain', chord: null, beats: 1, lyrics: '' });
        break;
    }
  }
  flushMeasure();

  return { song: { meta, masterBars, bars, rhythmLibrary, chordLibrary }, warnings };

  function flushMeasure() {
    if (measureEvents.length === 0) { inMeasure = false; return; }
    const idx = masterBars.length;
    const mb: MasterBar = { index: idx };
    // 段落标记：仅在段落变化时的首个小节
    if (currentSection && currentSection !== lastFlushedSection) {
      mb.section = { name: currentSection };
      mb.rhythmId = currentRhythmId ?? undefined;
      lastFlushedSection = currentSection;
    }
    masterBars.push(mb);
    bars.push({ masterBarIndex: idx, beats: buildBeats(measureEvents, meta.timeSignature) });
    measureEvents = [];
    inMeasure = false;
  }
}

// ---- 小节事件 → Beat[] ----

interface MeasureEvent {
  type: 'chord' | 'rest' | 'sustain';
  chord: string | null;
  beats: number | null;
  lyrics: string;
}

function buildBeats(events: MeasureEvent[], ts: TimeSignature): Beat[] {
  const total = ts.numerator;
  let assigned = 0;
  let unassigned = 0;
  for (const ev of events) {
    if (ev.beats !== null) assigned += ev.beats;
    else if (ev.type === 'chord') unassigned++;
    else assigned += 1;
  }
  const perUnassigned = unassigned > 0 ? (total - assigned) / unassigned : 0;

  return events.map(ev => {
    const dur = ev.beats ?? (ev.type === 'chord' ? perUnassigned : 1);
    return {
      duration: beatsToDuration(dur),
      notes: [],
      isRest: ev.type === 'rest',
      chordId: ev.chord ?? undefined,
      lyrics: ev.lyrics.trim() || undefined,
    };
  });
}

// ---- 元数据 ----

function applyMeta(meta: SongMeta, key: string, value: string): void {
  switch (key) {
    case 'title': meta.title = stripQuotes(value); break;
    case 'author': case 'artist': meta.artist = stripQuotes(value); break;
    case 'tempo': case 'bpm': meta.tempo = parseInt(value, 10) || 72; break;
    case 'time_signature': case 'time': {
      const m = value.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) meta.timeSignature = { numerator: +m[1], denominator: +m[2] };
      break;
    }
    case 'capo': meta.capo = parseInt(value, 10) || 0; break;
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

// ---- 节奏型定义 ----

function parseRhythmDef(
  line: string, lineNum: number,
  lib: Map<string, RhythmPattern>, warnings: BuildWarning[]
): void {
  // @ID: type(pattern)
  const m = line.match(/^@(\w+)\s*:\s*(pluck|strum)\s*\(\s*(.+)\s*\)\s*$/i);
  if (!m) {
    const simple = line.match(/^@(\w+)\s*:\s*(.+)/);
    if (simple) {
      const id = simple[1];
      const raw = simple[2].trim();
      const type: RhythmType = /[DUX]/i.test(raw) && !/^p/i.test(raw) ? 'strum' : 'pluck';
      lib.set(id, { id, type, raw, slots: parsePattern(raw, type) });
      return;
    }
    warnings.push({ message: `无法解析节奏型: "${line}"`, line: lineNum });
    return;
  }
  const id = m[1];
  const type = m[2].toLowerCase() as RhythmType;
  const rawFull = m[3].trim();
  const parts = rawFull.split(',');
  const raw = parts[0].trim();
  let speed: number | undefined;
  for (let i = 1; i < parts.length; i++) {
    const sm = parts[i].trim().match(/speed\s*=\s*([\d.]+)/);
    if (sm) speed = parseFloat(sm[1]);
  }
  lib.set(id, { id, type, raw, slots: parsePattern(raw, type), speed });
}

// ---- 自定义和弦 ----

function parseChordDef(
  line: string, lineNum: number,
  lib: Map<string, ChordDefinition>, warnings: BuildWarning[]
): void {
  const m = line.match(/define\s+\[([^\]]+)\]\s*:\s*\{\s*frets\s*:\s*"([^"]+)"\s*\}/);
  if (!m) { warnings.push({ message: `无法解析和弦: "${line}"`, line: lineNum }); return; }
  const name = m[1];
  const parts = m[2].trim().split(/\s+/);
  if (parts.length !== 6) {
    warnings.push({ message: `和弦 ${name} 需要 6 品位值，得到 ${parts.length}`, line: lineNum });
    return;
  }
  const frets = parts.map(s => s === 'x' || s === 'X' || s === '-1' ? -1 : parseInt(s, 10)) as GuitarFrets;
  lib.set(name, { id: name, displayName: name, frets });
}
