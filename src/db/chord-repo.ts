/**
 * 和弦 CRUD
 *
 * 操作 chords 表，提供和弦的增删改查。
 * source 字段区分来源: 'builtin' | 'user' | 'imported'
 */
import type { Database } from 'sql.js';
import type { ChordDefinition, GuitarFrets } from '../core/types';
import { getDb, persist } from './connection';

/** 数据库行 → ChordDefinition */
function rowToChord(row: Record<string, unknown>): ChordDefinition {
  const frets = JSON.parse(row.frets as string) as GuitarFrets;
  const chord: ChordDefinition = {
    id: row.id as string,
    displayName: row.display_name as string,
    frets,
    rootString: (row.root_string as number) ?? undefined,
    isSlash: !!(row.is_slash as number),
    bassNote: (row.bass_note as string) ?? undefined,
  };
  if (row.fingers) chord.fingers = JSON.parse(row.fingers as string);
  if (row.first_fret) chord.firstFret = row.first_fret as number;
  if (row.barre_fret) {
    chord.barre = {
      fret: row.barre_fret as number,
      fromString: row.barre_from as number,
      toString: row.barre_to as number,
    };
  }
  return chord;
}

/** 查询辅助: exec 返回对象数组 */
function queryAll(db: Database, sql: string, params?: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(db: Database, sql: string, params?: unknown[]): Record<string, unknown> | null {
  const rows = queryAll(db, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ---- 公开 API ----

/** 获取所有和弦 */
export async function getAllChords(): Promise<ChordDefinition[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM chords ORDER BY id').map(rowToChord);
}

/** 按 ID 获取和弦 */
export async function getChordById(id: string): Promise<ChordDefinition | null> {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM chords WHERE id = ?', [id]);
  return row ? rowToChord(row) : null;
}

/** 按来源获取和弦 */
export async function getChordsBySource(source: string): Promise<ChordDefinition[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM chords WHERE source = ? ORDER BY id', [source]).map(rowToChord);
}

/** 搜索和弦（模糊匹配 id 或 display_name） */
export async function searchChords(query: string): Promise<ChordDefinition[]> {
  const db = await getDb();
  const like = `%${query}%`;
  return queryAll(
    db,
    'SELECT * FROM chords WHERE id LIKE ? OR display_name LIKE ? ORDER BY id',
    [like, like]
  ).map(rowToChord);
}

/** 插入或更新和弦 */
export async function upsertChord(
  chord: ChordDefinition,
  source: string = 'user'
): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO chords (id, display_name, frets, fingers, first_fret,
       barre_fret, barre_from, barre_to, root_string, is_slash, bass_note, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name=excluded.display_name, frets=excluded.frets,
       fingers=excluded.fingers, first_fret=excluded.first_fret,
       barre_fret=excluded.barre_fret, barre_from=excluded.barre_from,
       barre_to=excluded.barre_to, root_string=excluded.root_string,
       is_slash=excluded.is_slash, bass_note=excluded.bass_note,
       source=excluded.source, updated_at=datetime('now')`,
    [
      chord.id,
      chord.displayName,
      JSON.stringify(chord.frets),
      chord.fingers ? JSON.stringify(chord.fingers) : null,
      chord.firstFret ?? 0,
      chord.barre?.fret ?? null,
      chord.barre?.fromString ?? null,
      chord.barre?.toString ?? null,
      chord.rootString ?? null,
      chord.isSlash ? 1 : 0,
      chord.bassNote ?? null,
      source,
    ]
  );
  await persist();
}

/** 批量插入和弦（用于初始化内置库） */
export async function bulkUpsertChords(
  chords: ChordDefinition[],
  source: string = 'builtin'
): Promise<number> {
  const db = await getDb();
  let count = 0;
  db.run('BEGIN TRANSACTION');
  try {
    for (const chord of chords) {
      db.run(
        `INSERT INTO chords (id, display_name, frets, fingers, first_fret,
           barre_fret, barre_from, barre_to, root_string, is_slash, bass_note, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          chord.id,
          chord.displayName,
          JSON.stringify(chord.frets),
          chord.fingers ? JSON.stringify(chord.fingers) : null,
          chord.firstFret ?? 0,
          chord.barre?.fret ?? null,
          chord.barre?.fromString ?? null,
          chord.barre?.toString ?? null,
          chord.rootString ?? null,
          chord.isSlash ? 1 : 0,
          chord.bassNote ?? null,
          source,
        ]
      );
      count++;
    }
    db.run('COMMIT');
    await persist();
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  return count;
}

/** 删除和弦 */
export async function deleteChord(id: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM chords WHERE id = ?', [id]);
  await persist();
}

/** 获取和弦被引用的吉他谱版本数 */
export async function getChordUsageCount(chordId: string): Promise<number> {
  const db = await getDb();
  const row = queryOne(
    db,
    'SELECT COUNT(*) as cnt FROM score_chords WHERE chord_id = ?',
    [chordId]
  );
  return (row?.cnt as number) ?? 0;
}
