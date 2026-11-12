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
const androidBuild = fs.readFileSync(path.join(root, 'scripts/build-android.ps1'), 'utf8');
const androidInsets = fs.readFileSync(path.join(root, 'scripts/configure-android-window-insets.mjs'), 'utf8');
const androidSigning = fs.readFileSync(path.join(root, 'scripts/configure-android-signing.mjs'), 'utf8');

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockSection = cargoLock.match(/\[\[package\]\]\r?\nname = "fund-boll-ledger"\r?\nversion = "([^"]+)"/);
const versions = {
  package: packageJson.version,
  packageLock: packageLock.version,
  packageLockRoot: packageLock.packages?.['']?.version,
  tauri: tauri.version,
  cargo: cargoVersion,
  cargoLock: cargoLockSection?.[1],
};
const expectedVersion = packageJson.version;
if (Object.values(versions).some((value) => value !== expectedVersion)) {
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
if (!androidBuild.includes('node "scripts/configure-android-signing.mjs"') || !androidBuild.includes('if (-not $Debug)')) {
  throw new Error('Android release build must configure persistent signing; debug builds must remain separate.');
}
if (!androidSigning.includes("'-storetype', 'PKCS12'") || !androidSigning.includes('storeType = "PKCS12"')) {
  throw new Error('Android persistent keystore generation and Gradle signing storeType must both explicitly use PKCS12.');
}
if (!androidBuild.includes('node "scripts/configure-android-window-insets.mjs"') ||
    !androidInsets.includes('FUND_BOLL_LEDGER_SYSTEM_BAR_INSETS') ||
    !androidInsets.includes('WindowCompat.setDecorFitsSystemWindows(window, false)') ||
    !androidInsets.includes('WindowInsetsCompat.Type.statusBars()')) {
  throw new Error('Android build must apply native status-bar/display-cutout insets to the generated Tauri activity.');
}
const nativeWorkflow = fs.readFileSync(path.join(root, '.github/workflows/native-build.yml'), 'utf8');
if (!nativeWorkflow.includes('workflow_dispatch:')) {
  throw new Error('Native build workflow must remain explicitly manually triggerable.');
}
for (const required of [
  'runs-on: windows-latest',
  'name: Windows desktop installer',
  'npm run desktop:build',
  'name: fund-boll-ledger-windows-x64',
  "if: ${{ vars.ANDROID_RELEASE_SIGNING_ENABLED == 'true' }}",
  'Configure persistent Android release signing',
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'verify --verbose',
  'keytool -list -v -keystore',
  'Signer #1 certificate SHA-256 digest',
  'Persistent Android signing certificate fingerprint verified.',
  `versionCode='${expectedVersionCode}' versionName='${expectedVersion}'`,
  'fund-boll-ledger-android-arm64-release-upgradeable',
]) {
  if (!nativeWorkflow.includes(required)) {
    throw new Error(`Native build upgrade-safety contract missing: ${required}`);
  }
}
if (!nativeWorkflow.includes('name: Android ARM64 ephemeral-signed smoke APK (not upgradeable)')) {
  throw new Error('Android debug smoke artifact must be explicitly distinguished from upgrade-compatible release APKs.');
}

console.log(`Upgrade contract PASS: version ${tauri.version}, Android versionCode ${expectedVersionCode}, app ID ${tauri.identifier}, Windows install mode currentUser, IndexedDB identity preserved.`);
