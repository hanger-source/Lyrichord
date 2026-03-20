/**
 * 节奏型 CRUD
 *
 * 操作 rhythm_patterns 表。
 */
import type { Database } from 'sql.js';
import type { RhythmPattern, RhythmSlot, RhythmType } from '../core/types';
import { getDb, persist } from './connection';

function rowToPattern(row: Record<string, unknown>): RhythmPattern {
  const pattern = {
    id: row.id as string,
    type: row.type as RhythmType,
    raw: row.raw as string,
    slots: JSON.parse(row.slots_json as string) as RhythmSlot[],
    speed: (row.speed as number) ?? undefined,
  };
  console.log('[rowToPattern]', pattern.id, 'type=', pattern.type, 'slotsKinds=', pattern.slots.map(s => s.kind));
  return pattern;
}

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

export async function getAllRhythms(): Promise<RhythmPattern[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM rhythm_patterns ORDER BY id').map(rowToPattern);
}

export async function getRhythmById(id: string): Promise<RhythmPattern | null> {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM rhythm_patterns WHERE id = ?', [id]);
  return row ? rowToPattern(row) : null;
}

export async function getRhythmsByType(type: RhythmType): Promise<RhythmPattern[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM rhythm_patterns WHERE type = ? ORDER BY id', [type]).map(rowToPattern);
}

export async function upsertRhythm(
  pattern: RhythmPattern,
  source: string = 'user'
): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT INTO rhythm_patterns (id, type, raw, slots_json, speed, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, raw=excluded.raw, slots_json=excluded.slots_json,
       speed=excluded.speed, source=excluded.source, updated_at=datetime('now')`,
    [
      pattern.id,
      pattern.type,
      pattern.raw,
      JSON.stringify(pattern.slots),
      pattern.speed ?? null,
      source,
    ]
  );
  await persist();
}

export async function bulkUpsertRhythms(
  patterns: RhythmPattern[],
  source: string = 'builtin'
): Promise<number> {
  const db = await getDb();
  let count = 0;
  db.run('BEGIN TRANSACTION');
  try {
    for (const p of patterns) {
      db.run(
        `INSERT INTO rhythm_patterns (id, type, raw, slots_json, speed, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, raw=excluded.raw, slots_json=excluded.slots_json,
           speed=excluded.speed, source=excluded.source, updated_at=datetime('now')`,
        [p.id, p.type, p.raw, JSON.stringify(p.slots), p.speed ?? null, source]
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

export async function deleteRhythm(id: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM rhythm_patterns WHERE id = ?', [id]);
  await persist();
}

export async function getRhythmUsageCount(rhythmId: string): Promise<number> {
  const db = await getDb();
  const row = queryOne(
    db,
    'SELECT COUNT(*) as cnt FROM score_rhythms WHERE rhythm_id = ?',
    [rhythmId]
  );
  return (row?.cnt as number) ?? 0;
}
