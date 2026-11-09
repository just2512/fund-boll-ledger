import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidRoot = path.join(root, 'src-tauri', 'gen', 'android');
const gradlePath = path.join(androidRoot, 'app', 'build.gradle.kts');
const propertiesPath = path.join(androidRoot, 'keystore.properties');
if (!fs.existsSync(gradlePath)) throw new Error('Android 工程尚未初始化：请先运行 cargo tauri android init。');

function keytoolPath() {
  const executable = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return executable;
}

function createLocalKey() {
  const directory = path.join(os.homedir(), '.fund-boll-ledger');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const configPath = path.join(directory, 'android-signing.json');
  const keystorePath = path.join(directory, 'android-release.keystore');
  if (fs.existsSync(configPath)) {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!fs.existsSync(saved.keystorePath)) throw new Error('本地 Android 签名配置存在，但密钥文件丢失。拒绝自动生成新密钥，以免破坏已安装应用的升级链。');
    return saved;
  }
  const password = randomBytes(32).toString('base64url');
  const alias = 'fundbollledger';
  const result = spawnSync(keytoolPath(), [
    '-genkeypair', '-noprompt', '-v', '-keystore', keystorePath, '-storetype', 'PKCS12',
    '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', password, '-keypass', password,
    '-dname', 'CN=Fund Boll Ledger, O=Personal, C=CN',
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('生成本地 Android 长期签名密钥失败。请确认 JDK keytool 可用。');
  const saved = { keystorePath, storePassword: password, keyPassword: password, keyAlias: alias };
  fs.writeFileSync(configPath, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
  console.log(`已创建本机长期 Android 签名密钥：${keystorePath}`);
  console.log(`密钥密码保存在用户目录：${configPath}。请备份密钥文件和密码；丢失后无法为现有安装包签发可升级版本。`);
  return saved;
}

function resolveSigningMaterial() {
  const encoded = process.env.ANDROID_KEYSTORE_BASE64?.trim();
  if (encoded) {
    const required = ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD', 'ANDROID_KEY_ALIAS'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Android release signing secrets missing: ${missing.join(', ')}`);
    const keystorePath = path.join(os.tmpdir(), `fund-boll-ledger-release-${process.pid}.p12`);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 1024) throw new Error('ANDROID_KEYSTORE_BASE64 解码后的文件过小，拒绝使用。');
    fs.writeFileSync(keystorePath, bytes, { mode: 0o600 });
    return {
      keystorePath,
      storePassword: process.env.ANDROID_KEYSTORE_PASSWORD,
      keyPassword: process.env.ANDROID_KEY_PASSWORD,
      keyAlias: process.env.ANDROID_KEY_ALIAS,
    };
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('GitHub release build requires stable ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD and ANDROID_KEY_ALIAS secrets. Refusing an ephemeral signing key.');
  }
  return createLocalKey();
}

const signing = resolveSigningMaterial();
let properties = [
  `storePassword=${signing.storePassword}`,
  `keyPassword=${signing.keyPassword}`,
  `keyAlias=${signing.keyAlias}`,
  `storeFile=${signing.keystorePath.split(path.sep).join('/')}`,
].join('\n') + '\n';
fs.writeFileSync(propertiesPath, properties, { mode: 0o600 });

let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('import java.io.FileInputStream')) gradle = 'import java.io.FileInputStream\n' + gradle;
if (!gradle.includes('import java.util.Properties')) gradle = 'import java.util.Properties\n' + gradle;
if (!gradle.includes('create("release")')) {
  const marker = '    buildTypes {';
  const index = gradle.indexOf(marker);
  if (index < 0) throw new Error('生成的 app/build.gradle.kts 中找不到 buildTypes 块，拒绝猜测 Gradle 修改位置。');
  const block = `    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            check(keystorePropertiesFile.exists()) { "Missing Android release keystore.properties" }
            val keystoreProperties = Properties()
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storeType = "PKCS12"
            storePassword = keystoreProperties["storePassword"] as String
        }
    }

`;
  gradle = gradle.slice(0, index) + block + gradle.slice(index);
}
const releasePattern = /getByName\("release"\)\s*\{/;
const releaseMatch = releasePattern.exec(gradle);
if (!releaseMatch) throw new Error('生成的 app/build.gradle.kts 中找不到 release buildType，拒绝生成未签名的升级包。');
const releaseStart = releaseMatch.index + releaseMatch[0].length;
const releasePreview = gradle.slice(releaseStart, releaseStart + 600);
if (!releasePreview.includes('signingConfig = signingConfigs.getByName("release")')) {
  gradle = gradle.slice(0, releaseStart)
    + '\n            signingConfig = signingConfigs.getByName("release")'
    + gradle.slice(releaseStart);
}
fs.writeFileSync(gradlePath, gradle);
console.log(`Android release signing configured with persistent alias "${signing.keyAlias}". Keystore material remains outside the repository.`);
