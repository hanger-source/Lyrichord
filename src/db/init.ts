/**
 * 数据库初始化
 *
 * 应用启动时调用，确保:
 * 1. SQLite 数据库已创建并建表
 * 2. 内置和弦库已同步到 chords 表
 *
 * ====== 关于表结构迁移 ======
 * 这里 **不做** ALTER TABLE 迁移。
 * 新列加在 schema.ts 的 CREATE TABLE 里（新用户直接有）。
 * 老用户通过 DbToolsPanel「升级表结构」按钮手动迁移。
 * 迁移逻辑写在 DbToolsPanel.tsx 的 runSchemaMigrations 里。
 *
 * **绝对不允许清除 IndexedDB 或让用户删库重建！**
 * 用户数据不可丢失，只能用 ALTER TABLE 增量迁移。
 * ============================
 */
import { getDb } from './connection';
import { bulkUpsertChords } from './chord-repo';
import { getAllChordDefs } from '../core/chord/database';

/**
 * 初始化数据库 + 同步内置和弦库
 */
export async function initDatabase(): Promise<{ chordCount: number }> {
  await getDb();

  // 同步内置和弦库到 SQLite
  const builtinChords = getAllChordDefs();
  const chordCount = await bulkUpsertChords(builtinChords, 'builtin');

  console.log(`[DB] 内置和弦库: ${builtinChords.length} 个和弦已同步`);

  return { chordCount };
}
