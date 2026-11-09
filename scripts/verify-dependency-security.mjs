import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = lock.packages ?? {};

function versionAtLeast(actual, minimum) {
  const parse = (value) => value.split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(actual);
  const b = parse(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(a[i])) return false;
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

const required = [
  ['node_modules/vite', '6.4.5'],
  ['node_modules/vitest', '4.1.12'],
  ['node_modules/@vitest/mocker', '4.1.12'],
];

const failures = [];
for (const [path, minimum] of required) {
  const actual = packages[path]?.version;
  if (!actual || !versionAtLeast(actual, minimum)) {
    failures.push(`${path}: expected >= ${minimum}, received ${actual ?? 'missing'}`);
  }
}

for (const [path, metadata] of Object.entries(packages)) {
  if (/(^|\/)node_modules\/@vitest\//.test(path)
      && !versionAtLeast(metadata.version ?? '', '4.1.12')) {
    failures.push(`${path}: vulnerable @vitest package version ${metadata.version ?? 'missing'}`);
  }
}

if (failures.length > 0) {
  console.error('Dependency security lockfile verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Dependency security lockfile verification passed: Vite >= 6.4.5; Vitest and all locked @vitest/* packages >= 4.1.12.');
}
