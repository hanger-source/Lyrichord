/**
 * SQLite 连接管理 (sql.js / WASM)
 *
 * 浏览器端使用 IndexedDB 持久化 SQLite 数据库文件。
 * 每次修改后自动保存到 IndexedDB。
 */
import initSqlJs, { type Database } from 'sql.js';
import { SCHEMA_DDL } from './schema';

const DB_NAME = 'lyrichord';
const IDB_STORE = 'databases';
const IDB_KEY = 'main.db';

let db: Database | null = null;
let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

/**
 * 初始化 sql.js WASM
 */
async function initWasm() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      // 手动 fetch wasm 二进制，避免 sql.js 内部 locateFile 路径问题
      const wasmResp = await fetch('/sql-wasm.wasm');
      const wasmBinary = await wasmResp.arrayBuffer();
      return initSqlJs({ wasmBinary });
    })();
  }
  return sqlPromise;
}

/**
 * 从 IndexedDB 加载数据库文件
 */
async function loadFromIDB(): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_KEY);
      getReq.onsuccess = () => resolve(getReq.result ?? null);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 保存数据库到 IndexedDB
 */
async function saveToIDB(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(data, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 获取数据库连接（单例）
 *
 * 首次调用时：
 * 1. 初始化 sql.js WASM
 * 2. 尝试从 IndexedDB 加载已有数据库
 * 3. 建表（IF NOT EXISTS）
 */
export async function getDb(): Promise<Database> {
  if (db) return db;

  const SQL = await initWasm();
  const saved = await loadFromIDB();

  if (saved) {
    db = new SQL.Database(saved);
  } else {
    db = new SQL.Database();
  }

  // 启用外键约束
  db.run('PRAGMA foreign_keys = ON');

  // 建表 + 索引（IF NOT EXISTS，幂等）
  for (const ddl of SCHEMA_DDL) {
    db.run(ddl);
  }

  return db;
}

/**
 * 持久化当前数据库到 IndexedDB
 *
 * 每次写操作后应调用此方法。
 */
export async function persist(): Promise<void> {
  if (!db) return;
  const data = db.export();
  await saveToIDB(data);
  // 自动备份关键数据到 localStorage
  backupToLocalStorage(db);
}

const BACKUP_KEY = 'lyrichord-backup';
const BACKUP_MAX = 5; // 保留最近 5 次快照

/**
 * 将段落和项目数据快照到 localStorage
 * 格式: { snapshots: [{ ts, segments, scores }], latest: ... }
 */
function backupToLocalStorage(database: Database): void {
  try {
    // 查段落
    const segStmt = database.prepare('SELECT * FROM tab_segments');
    const segments: Record<string, unknown>[] = [];
    while (segStmt.step()) segments.push(segStmt.getAsObject());
    segStmt.free();

    // 查项目
    const scoreStmt = database.prepare('SELECT id, title, artist FROM scores');
    const scores: Record<string, unknown>[] = [];
    while (scoreStmt.step()) scores.push(scoreStmt.getAsObject());
    scoreStmt.free();

    const snapshot = {
      ts: new Date().toISOString(),
      segments,
      scores,
    };

    // 读取已有备份
    let backups: { snapshots: typeof snapshot[] } = { snapshots: [] };
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (raw) backups = JSON.parse(raw);
    } catch {}

    // 追加新快照，保留最近 N 次
    backups.snapshots.push(snapshot);
    if (backups.snapshots.length > BACKUP_MAX) {
      backups.snapshots = backups.snapshots.slice(-BACKUP_MAX);
    }

    localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
  } catch (e) {
    console.warn('备份到 localStorage 失败:', e);
  }
}


