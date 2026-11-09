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

const requiredContractRules = [
  '唯一范围基线',
  '不授权增加任何产品功能',
  'A/B 两条工作线独立推进',
  '不得自行填入',
  'PASS',
  '不得删除失败测试',
  '恢复执行固定流程',
  '完成声明',
];
for (const rule of requiredContractRules) {
  if (!contract.includes(rule)) throw new Error(`Execution contract lost mandatory rule: ${rule}`);
}

const requiredPlanSections = [
  '## 1. 实施原则',
  '## 6. 计算核心验收门槛',
  '## 9. 执行状态记录',
  '## 21.',
  '## 22.',
  '## 23.',
];
for (const section of requiredPlanSections) {
  if (!plan.includes(section)) throw new Error(`Implementation baseline section missing: ${section}`);
}
for (const term of ['未来数据隔离', '账本隔离', '策略交易模拟', '样本外验证', '不得', 'UNKNOWN']) {
  if (!plan.includes(term)) throw new Error(`Implementation baseline lost mandatory scope term: ${term}`);
}

if (matrix.schemaVersion !== 1 || !Array.isArray(matrix.requirements) || matrix.requirements.length === 0) {
  throw new Error('Requirement matrix schema is invalid or empty.');
}
const allowed = new Set(['NOT_STARTED', 'IN_PROGRESS', 'PASS', 'FAIL', 'BLOCKED', 'MISSING', 'UNKNOWN']);
const ids = new Set();
for (const item of matrix.requirements) {
  if (!item.id || ids.has(item.id)) throw new Error(`Missing or duplicate requirement id: ${item.id}`);
  ids.add(item.id);
  if (!['A', 'B'].includes(item.track)) throw new Error(`Invalid track for ${item.id}`);
  if (!item.title || !Array.isArray(item.acceptance) || item.acceptance.length === 0 || item.acceptance.some((x) => !String(x).trim())) {
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
}
for (const requiredId of ['A-01', 'A-02', 'A-03', 'B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06', 'B-07', 'B-08', 'B-09', 'B-10', 'B-11', 'B-12', 'B-13', 'B-14', 'B-15', 'B-16']) {
  if (!ids.has(requiredId)) throw new Error(`Required baseline item was removed: ${requiredId}`);
}

const currentBacktestSourceExists = existsSync('src/backtest/market-bars.ts') && existsSync('src/backtest/walk-forward.ts');
const currentBacktestAcceptanceWorkflowExists = existsSync('.github/workflows/backtest-data-acceptance.yml');
if (!currentBacktestSourceExists && ['B-01', 'B-02', 'B-03'].some((id) => matrix.requirements.find((x) => x.id === id)?.status === 'PASS')) {
  throw new Error('Backtest source is absent from the current checkout; B-01/B-02/B-03 cannot be PASS.');
}
if (!currentBacktestAcceptanceWorkflowExists && matrix.requirements.find((x) => x.id === 'B-04')?.status === 'PASS') {
  throw new Error('Backtest real-data acceptance workflow is absent; B-04 cannot be PASS.');
}
console.log(`Execution contract verified: ${matrix.requirements.length} requirements, ${[...matrix.requirements].filter((x) => x.status === 'PASS').length} evidence-backed PASS, remaining work retained.`);
