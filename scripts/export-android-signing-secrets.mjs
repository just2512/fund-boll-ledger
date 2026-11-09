import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = path.join(os.homedir(), '.fund-boll-ledger');
const configPath = path.join(directory, 'android-signing.json');
if (!fs.existsSync(configPath)) throw new Error('尚未创建本机 Android 签名密钥。请先运行 scripts/configure-android-signing.mjs。');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!fs.existsSync(config.keystorePath)) throw new Error('Android keystore 文件不存在，拒绝导出不完整的签名信息。');
const output = path.join(directory, 'github-android-signing-secrets.txt');
const lines = [
  `ANDROID_KEYSTORE_BASE64=${fs.readFileSync(config.keystorePath).toString('base64')}`,
  `ANDROID_KEYSTORE_PASSWORD=${config.storePassword}`,
  `ANDROID_KEY_PASSWORD=${config.keyPassword}`,
  `ANDROID_KEY_ALIAS=${config.keyAlias}`,
];
fs.writeFileSync(output, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`GitHub Android signing secrets written outside the repository: ${output}`);
console.log('请只将文件中的四个值分别复制到 GitHub Repository Settings → Secrets and variables → Actions。不要提交或分享该文件。');
