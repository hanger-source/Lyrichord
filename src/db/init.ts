/**
 * 数据库初始化
 *
 * 应用启动时调用，确保:
 * 1. SQLite 数据库已创建并迁移到最新版本
 * 2. 内置和弦库已同步到 chords 表
 */
import { getDb } from './connection';
import { bulkUpsertChords } from './chord-repo';
import { getAllChordDefs } from '../core/chord/database';

/**
 * 初始化数据库 + 同步内置和弦库
 */
export async function initDatabase(): Promise<{ chordCount: number }> {
  // 确保数据库连接 + 迁移
  await getDb();

  // 同步内置和弦库到 SQLite
  const builtinChords = getAllChordDefs();
  const chordCount = await bulkUpsertChords(builtinChords, 'builtin');

  console.log(`[DB] 内置和弦库: ${builtinChords.length} 个和弦已同步`);

  return { chordCount };
}
