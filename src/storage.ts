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
      request.onsuccess = () => resolve((request.result as AppData | undefined) ?? emptyAppData());
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
