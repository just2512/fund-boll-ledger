import { existsSync, readFileSync } from 'node:fs';

const read = (path) => {
  try { return readFileSync(path, 'utf8'); }
  catch (error) {
    console.error(`[execution-contract] Missing required file: ${path}`);
    throw error;
  }
};

const contract = read('docs/EXECUTION_CONTRACT.md');
const plan = read('docs/TECHNICAL_STATE_ANALYSIS_IMPLEMENTATION_PLAN.md');
const matrix = JSON.parse(read('docs/TECHNICAL_STATE_REQUIREMENTS.json'));
const packageJson = JSON.parse(read('package.json'));

for (const rule of [
  '唯一产品范围',
  '不包含',
  '策略回测',
  '订单',
  '成交',
  '资金',
  '手续费',
  '收益',
  '不得',
  '历史重放',
]) {
  if (!contract.includes(rule)) throw new Error(`Execution contract lost mandatory scope rule: ${rule}`);
}

for (const section of ['## 1.', '## 21.', '## 22.', '## 23.', '## 24.']) {
  if (!plan.includes(section)) throw new Error(`Implementation plan section missing: ${section}`);
}
for (const term of ['范围校正', '不包含策略回测', 'BOLL', 'MACD', '未来数据']) {
  if (!plan.includes(term)) throw new Error(`Implementation plan lost mandatory scope term: ${term}`);
}

if (matrix.schemaVersion !== 1 || !Array.isArray(matrix.requirements) || matrix.requirements.length === 0) {
  throw new Error('Technical-state requirement matrix schema is invalid or empty.');
}
const allowed = new Set(['NOT_STARTED', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED', 'MISSING', 'UNKNOWN']);
const ids = new Set();
const byId = new Map();
for (const item of matrix.requirements) {
  if (!item.id || ids.has(item.id)) throw new Error(`Missing or duplicate requirement id: ${item.id}`);
  ids.add(item.id);
  byId.set(item.id, item);
  if (!item.area || !item.title || !Array.isArray(item.acceptance) || item.acceptance.length === 0 ||
      item.acceptance.some((x) => !String(x).trim())) {
    throw new Error(`Requirement ${item.id} has no explicit acceptance criteria.`);
  }
  if (!allowed.has(item.status)) throw new Error(`Invalid status for ${item.id}: ${item.status}`);
  if (!Array.isArray(item.evidence)) throw new Error(`Requirement ${item.id} evidence must be an array.`);
  if (item.status === 'PASS') {
    if (item.evidence.length === 0) throw new Error(`PASS without evidence is forbidden: ${item.id}`);
    for (const evidence of item.evidence) {
      if (!/^[0-9a-f]{7,40}$/i.test(evidence.commit ?? '')) throw new Error(`PASS without commit SHA: ${item.id}`);
      if (!/^https:\/\/github\.com\/.+/.test(evidence.url ?? '')) throw new Error(`PASS without traceable GitHub evidence URL: ${item.id}`);
    }
  }
  if ((item.status === 'IN_PROGRESS' || item.status === 'BLOCKED') && !String(item.blocker ?? '').trim()) {
    throw new Error(`${item.status} requirement must record its concrete blocker: ${item.id}`);
  }
}

for (const id of ['T-00','T-01','T-02','T-03','T-04','T-05','T-06','T-07','T-08','T-09','T-10','T-11']) {
  if (!ids.has(id)) throw new Error(`Required technical-state item was removed: ${id}`);
}

const requiredSources = {
  'T-01': ['src/technical-state/series.ts', 'src/technical-state/series.test.ts'],
  'T-02': ['src/technical-state/boll-state.ts', 'src/technical-state/boll-state.test.ts'],
  'T-04': ['src/macd.ts', 'src/macd.test.ts'],
  'T-05': ['src/macd.ts', 'src/macd.test.ts'],
  'T-06': ['src/technical-state/engine.ts', 'src/technical-state/engine.test.ts'],
  'T-08': ['src/technical-state/history-replay.ts', 'src/technical-state/engine.test.ts'],
};
for (const [id, paths] of Object.entries(requiredSources)) {
  if (byId.get(id)?.status === 'PASS') {
    for (const path of paths) {
      if (!existsSync(path)) throw new Error(`${id} cannot be PASS without current source/test: ${path}`);
    }
  }
}

if (existsSync('src/backtest')) throw new Error('Out-of-scope src/backtest directory must not exist.');
if (existsSync('.github/workflows/backtest-data-acceptance.yml')) {
  throw new Error('Out-of-scope backtest data acceptance workflow must not exist.');
}
if (Object.keys(packageJson.scripts ?? {}).some((name) => /backtest|strategy-sim|trade-sim/i.test(name))) {
  throw new Error('Out-of-scope backtest/strategy simulation npm scripts must not exist.');
}

const passCount = matrix.requirements.filter((item) => item.status === 'PASS').length;
console.log(`Execution contract verified: ${matrix.requirements.length} technical-state requirements, ${passCount} evidence-backed PASS; no backtest scope.`);
