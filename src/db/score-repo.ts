/**
 * 吉他谱 + 版本 CRUD
 *
 * scores: 一首歌
 * score_versions: 每次修改/AI 打磨产生新版本
 * score_chords / score_rhythms: 引用关系追踪
 */
import type { Database } from 'sql.js';
import type { Song } from '../core/types';
import { getDb, persist } from './connection';

// ---- 类型 ----

export interface ScoreRecord {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreVersionRecord {
  id: string;
  scoreId: string;
  version: number;
  tmdSource: string;
  tempo: number;
  timeSigN: number;
  timeSigD: number;
  capo: number;
  description?: string;
  createdAt: string;
}

export interface ScoreWithVersions extends ScoreRecord {
  versions: ScoreVersionRecord[];
  latestVersion?: ScoreVersionRecord;
}

// ---- 查询辅助 ----

function queryAll(db: Database, sql: string, params?: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(db: Database, sql: string, params?: unknown[]): Record<string, unknown> | null {
  const rows = queryAll(db, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function rowToScore(row: Record<string, unknown>): ScoreRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    artist: (row.artist as string) ?? undefined,
    album: (row.album as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToVersion(row: Record<string, unknown>): ScoreVersionRecord {
  return {
    id: row.id as string,
    scoreId: row.score_id as string,
    version: row.version as number,
    tmdSource: row.tmd_source as string,
    tempo: row.tempo as number,
    timeSigN: row.time_sig_n as number,
    timeSigD: row.time_sig_d as number,
    capo: row.capo as number,
    description: (row.description as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Score CRUD ----

export async function getAllScores(): Promise<ScoreRecord[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM scores ORDER BY updated_at DESC').map(rowToScore);
}

export async function getScoreById(id: string): Promise<ScoreRecord | null> {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM scores WHERE id = ?', [id]);
  return row ? rowToScore(row) : null;
}

export async function getScoreWithVersions(id: string): Promise<ScoreWithVersions | null> {
  const db = await getDb();
  const scoreRow = queryOne(db, 'SELECT * FROM scores WHERE id = ?', [id]);
  if (!scoreRow) return null;
  const score = rowToScore(scoreRow);
  const versions = queryAll(
    db,
    'SELECT * FROM score_versions WHERE score_id = ? ORDER BY version DESC',
    [id]
  ).map(rowToVersion);
  return {
    ...score,
    versions,
    latestVersion: versions[0],
  };
}

export async function searchScores(query: string): Promise<ScoreRecord[]> {
  const db = await getDb();
  const like = `%${query}%`;
  return queryAll(
    db,
    'SELECT * FROM scores WHERE title LIKE ? OR artist LIKE ? ORDER BY updated_at DESC',
    [like, like]
  ).map(rowToScore);
}

// ---- 保存吉他谱（含版本 + 引用关系） ----

/**
 * 保存吉他谱
 *
 * 如果 scoreId 存在 → 创建新版本
 * 如果 scoreId 不存在 → 创建新谱 + 第一个版本
 *
 * 同时记录该版本引用的所有和弦和节奏型。
 */
export async function saveScore(params: {
  scoreId?: string;
  tmdSource: string;
  song: Song;
  description?: string;
}): Promise<{ scoreId: string; versionId: string; version: number }> {
  const db = await getDb();
  const { tmdSource, song, description } = params;
  let scoreId = params.scoreId;

  db.run('BEGIN TRANSACTION');
  try {
    // 创建或更新 score
    if (!scoreId) {
      scoreId = generateId();
      db.run(
        'INSERT INTO scores (id, title, artist, album) VALUES (?, ?, ?, ?)',
        [scoreId, song.meta.title ?? '未命名', song.meta.artist ?? null, song.meta.album ?? null]
      );
    } else {
      db.run(
        `UPDATE scores SET title=?, artist=?, album=?, updated_at=datetime('now') WHERE id=?`,
        [song.meta.title ?? '未命名', song.meta.artist ?? null, song.meta.album ?? null, scoreId]
      );
    }

    // 获取下一个版本号
    const lastVer = queryOne(
      db,
      'SELECT MAX(version) as v FROM score_versions WHERE score_id = ?',
      [scoreId]
    );
    const nextVersion = ((lastVer?.v as number) ?? 0) + 1;

    // 创建版本
    const versionId = generateId();
    db.run(
      `INSERT INTO score_versions (id, score_id, version, tmd_source, tempo, time_sig_n, time_sig_d, capo, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId, scoreId, nextVersion, tmdSource,
        song.meta.tempo,
        song.meta.timeSignature.numerator,
        song.meta.timeSignature.denominator,
        song.meta.capo,
        description ?? null,
      ]
    );

    // 记录和弦引用
    const chordUsage = new Map<string, number>();
    for (const bar of song.bars) {
      for (const beat of bar.beats) {
        if (beat.chordId) {
          chordUsage.set(beat.chordId, (chordUsage.get(beat.chordId) ?? 0) + 1);
        }
      }
    }
    for (const [chordId, count] of chordUsage) {
      db.run(
        `INSERT OR IGNORE INTO score_chords (score_version_id, chord_id, usage_count)
         VALUES (?, ?, ?)`,
        [versionId, chordId, count]
      );
    }

    // 记录节奏型引用
    const rhythmUsage = new Map<string, number>();
    for (const mb of song.masterBars) {
      if (mb.rhythmId) {
        rhythmUsage.set(mb.rhythmId, (rhythmUsage.get(mb.rhythmId) ?? 0) + 1);
      }
    }
    for (const [rhythmId, count] of rhythmUsage) {
      db.run(
        `INSERT OR IGNORE INTO score_rhythms (score_version_id, rhythm_id, usage_count)
         VALUES (?, ?, ?)`,
        [versionId, rhythmId, count]
      );
    }

    db.run('COMMIT');
    await persist();

    return { scoreId, versionId, version: nextVersion };
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

// ---- 版本查询 ----

export async function getVersionsByScore(scoreId: string): Promise<ScoreVersionRecord[]> {
  const db = await getDb();
  return queryAll(
    db,
    'SELECT * FROM score_versions WHERE score_id = ? ORDER BY version DESC',
    [scoreId]
  ).map(rowToVersion);
}

export async function getVersionById(versionId: string): Promise<ScoreVersionRecord | null> {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM score_versions WHERE id = ?', [versionId]);
  return row ? rowToVersion(row) : null;
}

export async function getLatestVersion(scoreId: string): Promise<ScoreVersionRecord | null> {
  const db = await getDb();
  const row = queryOne(
    db,
    'SELECT * FROM score_versions WHERE score_id = ? ORDER BY version DESC LIMIT 1',
    [scoreId]
  );
  return row ? rowToVersion(row) : null;
}

// ---- 引用关系查询 ----

/** 获取某个版本使用的所有和弦 ID */
export async function getChordsForVersion(versionId: string): Promise<string[]> {
  const db = await getDb();
  return queryAll(
    db,
    'SELECT chord_id FROM score_chords WHERE score_version_id = ? ORDER BY usage_count DESC',
    [versionId]
  ).map(r => r.chord_id as string);
}

/** 获取某个版本使用的所有节奏型 ID */
export async function getRhythmsForVersion(versionId: string): Promise<string[]> {
  const db = await getDb();
  return queryAll(
    db,
    'SELECT rhythm_id FROM score_rhythms WHERE score_version_id = ? ORDER BY usage_count DESC',
    [versionId]
  ).map(r => r.rhythm_id as string);
}

/** 获取使用了某个和弦的所有吉他谱 */
export async function getScoresUsingChord(chordId: string): Promise<ScoreRecord[]> {
  const db = await getDb();
  return queryAll(
    db,
    `SELECT DISTINCT s.* FROM scores s
     JOIN score_versions sv ON sv.score_id = s.id
     JOIN score_chords sc ON sc.score_version_id = sv.id
     WHERE sc.chord_id = ?
     ORDER BY s.updated_at DESC`,
    [chordId]
  ).map(rowToScore);
}

/** 获取使用了某个节奏型的所有吉他谱 */
export async function getScoresUsingRhythm(rhythmId: string): Promise<ScoreRecord[]> {
  const db = await getDb();
  return queryAll(
    db,
    `SELECT DISTINCT s.* FROM scores s
     JOIN score_versions sv ON sv.score_id = s.id
     JOIN score_rhythms sr ON sr.score_version_id = sv.id
     WHERE sr.rhythm_id = ?
     ORDER BY s.updated_at DESC`,
    [rhythmId]
  ).map(rowToScore);
}

/** 删除吉他谱（级联删除版本和引用） */
export async function deleteScore(id: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM scores WHERE id = ?', [id]);
  await persist();
}
