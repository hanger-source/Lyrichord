/**
 * 迁移脚本: 孤儿段落归属项目
 *
 * 用法: 在浏览器 console 执行 window.__migrateOrphanSegments()
 * 或者在代码中 import { migrateOrphanSegments } from './migrate-orphan-segments'
 *
 * 做什么:
 *   1. 找到所有 project_id IS NULL 的 tab_segments
 *   2. 确保存在默认项目（你瞒我瞒 / 陈柏宇）
 *   3. 把孤儿段落的 project_id 指向该项目
 */
import { getDb, persist } from './connection';

export async function migrateOrphanSegments(): Promise<{ migrated: number; projectId: string }> {
  const db = await getDb();

  // 统计孤儿段落
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM tab_segments WHERE project_id IS NULL');
  countStmt.step();
  const orphanCount = (countStmt.getAsObject() as { cnt: number }).cnt;
  countStmt.free();

  if (orphanCount === 0) {
    console.log('[迁移] 没有孤儿段落，无需迁移');
    return { migrated: 0, projectId: '' };
  }

  // 找已有项目
  const scoreStmt = db.prepare('SELECT id FROM scores LIMIT 1');
  let projectId: string | null = null;
  if (scoreStmt.step()) {
    projectId = (scoreStmt.getAsObject() as { id: string }).id;
  }
  scoreStmt.free();

  // 没有项目 → 创建
  if (!projectId) {
    projectId = `${Date.now()}-default`;
    db.run("INSERT INTO scores (id, title, artist) VALUES (?, '你瞒我瞒', '陈柏宇')", [projectId]);
  }

  // 迁移
  db.run('UPDATE tab_segments SET project_id = ? WHERE project_id IS NULL', [projectId]);
  await persist();

  console.log(`[迁移] ${orphanCount} 个孤儿段落已归属到项目 ${projectId}`);
  return { migrated: orphanCount, projectId };
}

// 挂到 window 上方便 console 调用
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__migrateOrphanSegments = migrateOrphanSegments;
}
