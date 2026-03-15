/**
 * TAB 段落 CRUD
 */
import type { Database } from 'sql.js';
import { getDb, persist } from './connection';

export interface SegmentRecord {
  id: string;
  name: string;
  projectId: string | null;
  bpm: number;
  tsLabel: string;
  measuresJson: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function queryAll(db: Database, sql: string, params?: unknown[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function rowToSegment(row: Record<string, unknown>): SegmentRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    projectId: (row.project_id as string) ?? null,
    bpm: row.bpm as number,
    tsLabel: row.ts_label as string,
    measuresJson: row.measures_json as string,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function generateId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function getAllSegments(): Promise<SegmentRecord[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM tab_segments ORDER BY updated_at DESC').map(rowToSegment);
}

export async function getSegmentsByProject(projectId: string): Promise<SegmentRecord[]> {
  const db = await getDb();
  return queryAll(
    db,
    'SELECT * FROM tab_segments WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC',
    [projectId]
  ).map(rowToSegment);
}

export async function getOrphanSegments(): Promise<SegmentRecord[]> {
  const db = await getDb();
  return queryAll(db, 'SELECT * FROM tab_segments WHERE project_id IS NULL ORDER BY updated_at DESC').map(rowToSegment);
}

export async function saveSegment(params: {
  id?: string;
  name: string;
  projectId?: string | null;
  bpm: number;
  tsLabel: string;
  measuresJson: string;
  sortOrder?: number;
}): Promise<SegmentRecord> {
  const db = await getDb();
  const { name, bpm, tsLabel, measuresJson } = params;
  const projectId = params.projectId ?? null;
  const sortOrder = params.sortOrder ?? 0;
  const id = params.id ?? generateId();

  if (params.id) {
    db.run(
      `UPDATE tab_segments SET name=?, project_id=?, bpm=?, ts_label=?, measures_json=?, sort_order=?, updated_at=datetime('now') WHERE id=?`,
      [name, projectId, bpm, tsLabel, measuresJson, sortOrder, id]
    );
  } else {
    db.run(
      `INSERT INTO tab_segments (id, name, project_id, bpm, ts_label, measures_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, projectId, bpm, tsLabel, measuresJson, sortOrder]
    );
  }
  await persist();
  const rows = queryAll(db, 'SELECT * FROM tab_segments WHERE id = ?', [id]);
  return rowToSegment(rows[0]);
}

export async function deleteSegment(id: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM tab_segments WHERE id = ?', [id]);
  await persist();
}
