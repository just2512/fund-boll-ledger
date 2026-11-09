import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const tauri = readJson('src-tauri/tauri.conf.json');
const cargoToml = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
const cargoLock = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'src/storage.ts'), 'utf8');

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockSection = cargoLock.match(/\[\[package\]\]\nname = "fund-boll-ledger"\nversion = "([^"]+)"/);
const versions = {
  package: packageJson.version,
  packageLock: packageLock.version,
  packageLockRoot: packageLock.packages?.['']?.version,
  tauri: tauri.version,
  cargo: cargoVersion,
  cargoLock: cargoLockSection?.[1],
};
if (Object.values(versions).some((value) => value !== '0.2.0')) {
  throw new Error(`版本号未同步：${JSON.stringify(versions)}`);
}
if (tauri.identifier !== 'com.just2512.fundbollledger') {
  throw new Error('Tauri application identifier changed; this can break Android upgrade identity and local data paths.');
}
if (tauri.productName !== '基金阶梯账本') throw new Error('Tauri productName changed unexpectedly.');
if (tauri.bundle?.windows?.nsis?.installMode !== 'currentUser') {
  throw new Error('Windows NSIS installMode must remain currentUser to keep the established per-user install identity.');
}
const match = tauri.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) throw new Error('Tauri version must be semantic versioning.');
const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]);
const expectedVersionCode = major * 1_000_000 + minor * 1_000 + patch;
if (tauri.bundle?.android?.versionCode !== expectedVersionCode) {
  throw new Error(`Android versionCode mismatch: expected ${expectedVersionCode}, got ${tauri.bundle?.android?.versionCode}`);
}
if (tauri.bundle.android.autoIncrementVersionCode !== false) {
  throw new Error('Android versionCode must be explicitly pinned for repeatable upgrade builds.');
}
if (!storage.includes("const DB_NAME = 'fund-boll-ledger'") || !storage.includes("const STORE_NAME = 'app-state'")) {
  throw new Error('IndexedDB database/store identity changed; a deliberate data migration is required.');
}
console.log(`Upgrade contract PASS: version ${tauri.version}, Android versionCode ${expectedVersionCode}, app ID ${tauri.identifier}, Windows install mode currentUser, IndexedDB identity preserved.`);
