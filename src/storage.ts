import type { AppData } from './types';
import { emptyAppData } from './types';

const DB_NAME = 'fund-boll-ledger';
const STORE_NAME = 'app-state';
const STATE_KEY = 'main';
let pendingWrite: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持 IndexedDB，请使用新版 Edge 或 Chrome。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
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
