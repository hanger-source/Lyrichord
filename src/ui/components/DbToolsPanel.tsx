/**
 * 数据库工具面板 — 从 Header 齿轮图标打开
 *
 * 提供: 数据状态检查、孤儿段落迁移等维护操作
 */
import { useState, useCallback } from 'react';
import { getDb, persist } from '../../db/connection';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-tiny" onClick={checkStatus} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          检查状态
        </button>
        <button className="btn-tiny" onClick={runMigration} disabled={loading}
          style={{ padding: '4px 12px', fontSize: 13 }}>
          迁移孤儿段落
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
