/**
 * 数据库工具面板 — 从 Header 齿轮图标打开
 *
 * 职责：数据库维护操作的统一入口
 * - 检查状态：查看段落数、孤儿段落、项目列表
 * - 迁移孤儿段落：把 project_id IS NULL 的段落归属到默认项目
 * - 升级表结构：ALTER TABLE 补列（schema.ts 加了新列但旧 IndexedDB 里的表没有时用）
 *
 * ====== 如何添加新的表结构迁移 ======
 * 1. 在 schema.ts 的 CREATE TABLE 里加新列（新用户直接建表就有）
 * 2. 在下面 runSchemaMigrations 函数里加一段：
 *    if (!colNames.includes('新列名')) {
 *      db.run("ALTER TABLE 表名 ADD COLUMN 新列名 类型 DEFAULT 默认值");
 *      added.push('新列名');
 *    }
 * 3. 老用户打开数据库工具面板点「升级表结构」即可
 * ==========================================
 */
import { useState, useCallback } from 'react';
import { getDb, persist } from '../../db/connection';

// ---- 导出辅助 ----

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function queryAllRows(db: import('sql.js').Database, sql: string): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

interface DbStatus {
  totalSegments: number;
  orphanSegments: number;
  scores: Array<{ id: string; title: string }>;
}

export function DbToolsPanel() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();

      const segStmt = db.prepare('SELECT COUNT(*) as cnt FROM tab_segments');
      segStmt.step();
      const totalSegments = (segStmt.getAsObject() as { cnt: number }).cnt;
      segStmt.free();

      const orphanStmt = db.prepare('SELECT COUNT(*) as cnt FROM tab_segments WHERE project_id IS NULL');
      orphanStmt.step();
      const orphanSegments = (orphanStmt.getAsObject() as { cnt: number }).cnt;
      orphanStmt.free();

      const scoreStmt = db.prepare('SELECT id, title FROM scores');
      const scores: Array<{ id: string; title: string }> = [];
      while (scoreStmt.step()) {
        const row = scoreStmt.getAsObject() as { id: string; title: string };
        scores.push(row);
      }
      scoreStmt.free();

      setStatus({ totalSegments, orphanSegments, scores });
      setLog('');
    } catch (e) {
      setLog('检查失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const runSchemaMigrations = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const cols = db.exec("PRAGMA table_info(tab_segments)");
      const colNames = cols.length > 0 ? cols[0].values.map((r: unknown[]) => r[1] as string) : [];
      const added: string[] = [];

      if (!colNames.includes('tempo')) {
        db.run("ALTER TABLE tab_segments ADD COLUMN tempo INTEGER NOT NULL DEFAULT 72");
        added.push('tempo');
      }

      if (added.length === 0) {
        setLog('表结构已是最新，无需升级。');
      } else {
        await persist();
        setLog(`升级完成，新增列: ${added.join(', ')}`);
      }
    } catch (e) {
      setLog('升级失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const runMigration = useCallback(async () => {
    setLoading(true);
    try {
      const { migrateOrphanSegments } = await import('../../db/migrate-orphan-segments');
      const result = await migrateOrphanSegments();
      if (result.migrated === 0) {
        setLog('无需迁移，没有孤儿段落。');
      } else {
        setLog(`迁移完成：${result.migrated} 个段落已归属到项目 ${result.projectId}`);
      }
      // 刷新状态
      await checkStatus();
    } catch (e) {
      setLog('迁移失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [checkStatus]);

  const exportSqlite = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const data = db.export();
      const blob = new Blob([data], { type: 'application/x-sqlite3' });
      const ts = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `lyrichord-${ts}.db`);
      setLog('SQLite 数据库已导出');
    } catch (e) {
      setLog('导出失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const exportJson = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const dump: Record<string, unknown[]> = {
        scores: queryAllRows(db, 'SELECT * FROM scores'),
        score_versions: queryAllRows(db, 'SELECT * FROM score_versions'),
        tab_segments: queryAllRows(db, 'SELECT * FROM tab_segments'),
        chords: queryAllRows(db, 'SELECT * FROM chords'),
        rhythm_patterns: queryAllRows(db, 'SELECT * FROM rhythm_patterns'),
        score_chords: queryAllRows(db, 'SELECT * FROM score_chords'),
        score_rhythms: queryAllRows(db, 'SELECT * FROM score_rhythms'),
      };
      const json = JSON.stringify(dump, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const ts = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `lyrichord-${ts}.json`);
      setLog(`JSON 已导出 (${Object.values(dump).reduce((s, a) => s + a.length, 0)} 条记录)`);
    } catch (e) {
      setLog('导出失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-tiny" onClick={checkStatus} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          检查状态
        </button>
        <button className="btn-tiny" onClick={runMigration} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          迁移孤儿段落
        </button>
        <button className="btn-tiny" onClick={runSchemaMigrations} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          升级表结构
        </button>
        <span style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        <button className="btn-tiny" onClick={exportSqlite} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          导出 SQLite
        </button>
        <button className="btn-tiny" onClick={exportJson} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          导出 JSON
        </button>
      </div>

      {status && (
        <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 6, lineHeight: 1.6 }}>
          <div>段落总数: {status.totalSegments}</div>
          <div style={{ color: status.orphanSegments > 0 ? 'var(--danger)' : 'var(--success)' }}>
            孤儿段落: {status.orphanSegments}
          </div>
          <div style={{ marginTop: 8 }}>
            项目 ({status.scores.length}):
            {status.scores.length === 0
              ? <span style={{ color: 'var(--text-secondary)' }}> 无</span>
              : <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {status.scores.map(s => <li key={s.id}>{s.title}</li>)}
                </ul>
            }
          </div>
        </div>
      )}

      {log && (
        <div style={{
          padding: 8, borderRadius: 4, fontSize: 12,
          background: log.includes('失败') ? 'var(--danger-bg, #fef2f2)' : 'var(--success-bg, #f0fdf4)',
          color: log.includes('失败') ? 'var(--danger)' : 'var(--success)',
        }}>
          {log}
        </div>
      )}
    </div>
  );
}
