import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  command,
  ['exec', '--', 'vitest', 'run', 'src/technical-state/calibration.test.ts', 'src/technical-state/real-data.calibration.live.test.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, RUN_LIVE_TECHNICAL_CALIBRATION: '1' },
    shell: process.platform === 'win32',
  },
);
if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
