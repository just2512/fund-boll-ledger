import type { AppData } from './types';
import { emptyAppData } from './types';

const DB_NAME = 'fund-boll-ledger';
const DB_VERSION = 2;
const STORE_NAME = 'app-state';
const META_STORE_NAME = 'app-meta';
const STATE_KEY = 'main';
const LAST_BACKUP_KEY = 'last-backup-at';
const DATABASE_SCHEMA_KEY = 'database-schema';
let pendingWrite: Promise<void> = Promise.resolve();

export interface StorageMetadata {
  lastBackupAt: string | null;
  databaseMigration: { fromVersion: number; toVersion: number; migratedAt: string } | null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持 IndexedDB，请使用新版 Edge 或 Chrome。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(META_STORE_NAME)) db.createObjectStore(META_STORE_NAME);
      // Additive migration only: never rewrite or delete the existing ledger record.
      request.transaction?.objectStore(META_STORE_NAME).put({
        fromVersion: event.oldVersion,
        toVersion: DB_VERSION,
        migratedAt: new Date().toISOString(),
      }, DATABASE_SCHEMA_KEY);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
    request.onblocked = () => reject(new Error('本地数据库升级被其他页面阻塞。请关闭同一账本的其他窗口后重试。'));
  });
}

export async function loadAppData(): Promise<AppData> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => {
        const stored = request.result as AppData | undefined;
        // A bare cast would let a corrupted record crash rendering later; validate the
        // envelope here so the app degrades to an empty ledger with a readable message.
        if (stored === undefined) { resolve(emptyAppData()); return; }
        if (!stored || typeof stored !== 'object'
          || stored.schemaVersion !== 1
          || !Array.isArray(stored.funds) || !Array.isArray(stored.trades) || !Array.isArray(stored.snapshots)) {
          reject(new Error('本地数据格式无法识别，已停止加载以免损坏账本。请导出备份后反馈排查。'));
          return;
        }
        resolve(stored);
      };
      request.onerror = () => reject(request.error ?? new Error('读取本地数据失败'));
    });
  } finally {
    db.close();
  }
}

export async function loadStorageMetadata(): Promise<StorageMetadata> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readonly');
      const store = tx.objectStore(META_STORE_NAME);
      let lastBackupAt: string | null = null;
      let databaseMigration: StorageMetadata['databaseMigration'] = null;
      const backupRequest = store.get(LAST_BACKUP_KEY);
      const migrationRequest = store.get(DATABASE_SCHEMA_KEY);
      backupRequest.onsuccess = () => {
        if (typeof backupRequest.result === 'string') lastBackupAt = backupRequest.result;
      };
      migrationRequest.onsuccess = () => {
        const value = migrationRequest.result as StorageMetadata['databaseMigration'];
        if (value && typeof value === 'object'
          && Number.isInteger(value.fromVersion) && Number.isInteger(value.toVersion)
          && typeof value.migratedAt === 'string') databaseMigration = value;
      };
      tx.oncomplete = () => resolve({ lastBackupAt, databaseMigration });
      tx.onerror = () => reject(tx.error ?? new Error('读取本地迁移信息失败'));
      tx.onabort = () => reject(tx.error ?? new Error('读取本地迁移信息已中断'));
    });
  } finally {
    db.close();
  }
}

export async function saveLastBackupAt(timestamp: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, 'readwrite');
      tx.objectStore(META_STORE_NAME).put(timestamp, LAST_BACKUP_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('记录备份导出时间失败'));
      tx.onabort = () => reject(tx.error ?? new Error('记录备份导出时间已中断'));
    });
  } finally {
    db.close();
  }
}

export function saveAppData(data: AppData): Promise<void> {
  // Serialize writes so a slower earlier IndexedDB open cannot overwrite a newer state.
  pendingWrite = pendingWrite.catch(() => undefined).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, STATE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('保存本地数据失败'));
        tx.onabort = () => reject(tx.error ?? new Error('本地数据保存已中断'));
      });
    } finally {
      db.close();
    }
  });
  return pendingWrite;
}
