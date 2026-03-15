/**
 * Lyrichord SQLite Schema
 *
 * 纯 DDL，全部 IF NOT EXISTS，启动时直接执行。
 * 后续改表结构直接改这里 + 写一次性脚本 ALTER TABLE。
 */

export const SCHEMA_DDL: string[] = [
  // ---- 和弦库 ----
  `CREATE TABLE IF NOT EXISTS chords (
    id          TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    frets       TEXT NOT NULL,
    fingers     TEXT,
    first_fret  INTEGER DEFAULT 0,
    barre_fret  INTEGER,
    barre_from  INTEGER,
    barre_to    INTEGER,
    root_string INTEGER,
    is_slash    INTEGER DEFAULT 0,
    bass_note   TEXT,
    source      TEXT NOT NULL DEFAULT 'builtin',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ---- 节奏型库 ----
  `CREATE TABLE IF NOT EXISTS rhythm_patterns (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK(type IN ('pluck', 'strum')),
    raw         TEXT NOT NULL,
    slots_json  TEXT NOT NULL,
    speed       REAL,
    source      TEXT NOT NULL DEFAULT 'builtin',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ---- 吉他谱 ----
  `CREATE TABLE IF NOT EXISTS scores (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    artist      TEXT,
    album       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ---- 吉他谱版本 ----
  `CREATE TABLE IF NOT EXISTS score_versions (
    id          TEXT PRIMARY KEY,
    score_id    TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL DEFAULT 1,
    tmd_source  TEXT NOT NULL,
    tempo       INTEGER NOT NULL DEFAULT 72,
    time_sig_n  INTEGER NOT NULL DEFAULT 4,
    time_sig_d  INTEGER NOT NULL DEFAULT 4,
    capo        INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(score_id, version)
  )`,

  // ---- 吉他谱 ↔ 和弦 引用 ----
  `CREATE TABLE IF NOT EXISTS score_chords (
    score_version_id TEXT NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
    chord_id         TEXT NOT NULL REFERENCES chords(id),
    usage_count      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (score_version_id, chord_id)
  )`,

  // ---- 吉他谱 ↔ 节奏型 引用 ----
  `CREATE TABLE IF NOT EXISTS score_rhythms (
    score_version_id TEXT NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
    rhythm_id        TEXT NOT NULL REFERENCES rhythm_patterns(id),
    usage_count      INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (score_version_id, rhythm_id)
  )`,

  // ---- 索引 ----
  `CREATE INDEX IF NOT EXISTS idx_score_versions_score ON score_versions(score_id)`,
  `CREATE INDEX IF NOT EXISTS idx_score_chords_chord ON score_chords(chord_id)`,
  `CREATE INDEX IF NOT EXISTS idx_score_rhythms_rhythm ON score_rhythms(rhythm_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chords_source ON chords(source)`,
];
