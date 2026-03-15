/**
 * 数据库初始化
 *
 * 应用启动时调用，确保:
 * 1. SQLite 数据库已创建并迁移到最新版本
 * 2. 内置和弦库已同步到 chords 表
 * 3. 管线解析出的自定义和弦/节奏型已注册
 */
import { getDb } from './connection';
import { bulkUpsertChords } from './chord-repo';
import { CHORD_DATABASE } from '../core/chord/database';
import type { ChordDefinition, GuitarFrets } from '../core/types';

/**
 * 初始化数据库 + 同步内置和弦库
 */
export async function initDatabase(): Promise<{ chordCount: number }> {
  // 确保数据库连接 + 迁移
  await getDb();

  // 同步内置和弦库到 SQLite
  const builtinChords = buildChordDefinitions();
  const chordCount = await bulkUpsertChords(builtinChords, 'builtin');

  console.log(`[DB] 内置和弦库: ${builtinChords.length} 个和弦已同步`);

  return { chordCount };
}

/**
 * 从 CHORD_DATABASE 构建 ChordDefinition 数组
 */
function buildChordDefinitions(): ChordDefinition[] {
  const chords: ChordDefinition[] = [];
  for (const [id, frets] of Object.entries(CHORD_DATABASE)) {
    chords.push({
      id,
      displayName: id,
      frets: frets as GuitarFrets,
      rootString: findRootString(frets as GuitarFrets),
      isSlash: id.includes('/'),
      bassNote: id.includes('/') ? id.split('/')[1] : undefined,
    });
  }
  return chords;
}

function findRootString(frets: GuitarFrets): number {
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] >= 0) return 6 - i;
  }
  return 6;
}
