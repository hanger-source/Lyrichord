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
 * 3. 运行迁移
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

  // 建表（IF NOT EXISTS，幂等）
  for (const ddl of SCHEMA_DDL) {
    db.run(ddl);
  }

  // ---- Schema 迁移: 为旧数据库添加新列 ----
  const migrations: Array<{ table: string; column: string; type: string }> = [
    { table: 'chords', column: 'positions_json', type: 'TEXT' },
    { table: 'chords', column: 'midi_json', type: 'TEXT' },
    { table: 'chords', column: 'chord_key', type: 'TEXT' },
    { table: 'chords', column: 'suffix', type: 'TEXT' },
  ];

  for (const m of migrations) {
    try {
      db.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
    } catch {
      // 列已存在，忽略（SQLite ALTER TABLE ADD COLUMN 重复会报错）
    }
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
}


