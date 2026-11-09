import { calculatePosition } from './calculations';
import { parseMoneyCents, parseQuantity, parseScaled } from './decimal';
import type { AppData, Fund, PriceSnapshot, Trade } from './types';

export type BackupValidationResult =
  | { valid: true; data: AppData; errors: [] }
  | { valid: false; errors: string[] };

const FUND_CATEGORIES = ['ETF', 'LOF', '债券ETF', '货币ETF', '其他场内基金'];
const MARKETS = ['沪市', '深市', '其他/未确认'];
const PRICE_KEYS = ['upper', 'middle', 'lower', 'previousClose', 'lastTradePrice', 'currentPrice'] as const;
const LADDER_BASES = ['upper', 'middle', 'lower', 'previousClose', 'lastTradePrice'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPositiveDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  return parseScaled(value) > 0n;
}

function validatePrices(value: unknown, label: string, errors: string[]): boolean {
  if (!isRecord(value)) {
    errors.push(label + '缺失或不是对象');
    return false;
  }
  let valid = true;
  for (const key of PRICE_KEYS) {
    const price = value[key];
    if (typeof price !== 'string') {
      errors.push(label + '的 ' + key + ' 必须是字符串');
      valid = false;
    } else if (price.trim() && !isPositiveDecimal(price)) {
      errors.push(label + '的 ' + key + ' 必须为空或大于零的有效价格');
      valid = false;
    }
  }
  return valid;
}

function validateFund(value: unknown, index: number, ids: Set<string>, errors: string[]): value is Fund {
  const label = '基金[' + (index + 1) + ']';
  if (!isRecord(value)) { errors.push(label + '不是对象'); return false; }
  let valid = true;
  if (typeof value.id !== 'string' || !value.id.trim()) { errors.push(label + '缺少有效 ID'); valid = false; }
  else if (ids.has(value.id)) { errors.push(label + 'ID 重复：' + value.id); valid = false; }
  else ids.add(value.id);
  if (typeof value.name !== 'string' || !value.name.trim()) { errors.push(label + '名称不能为空'); valid = false; }
  for (const field of ['code', 'notes'] as const) if (typeof value[field] !== 'string') { errors.push(label + field + '必须是字符串'); valid = false; }
  if (!MARKETS.includes(String(value.market))) { errors.push(label + '交易市场值无效'); valid = false; }
  if (!FUND_CATEGORIES.includes(String(value.category))) { errors.push(label + '基金类别值无效'); valid = false; }
  if (!isPositiveDecimal(value.tickSize)) { errors.push(label + '最小价格变动单位必须大于零'); valid = false; }
  if (!LADDER_BASES.includes(String(value.ladderBasis))) { errors.push(label + '阶梯基准值无效'); valid = false; }
  if (value.ladderDirection !== 'up' && value.ladderDirection !== 'down') { errors.push(label + '阶梯方向值无效'); valid = false; }
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)) { errors.push(label + '创建/更新时间无效'); valid = false; }
  if (!validatePrices(value.prices, label + '价格', errors)) valid = false;
  return valid;
}

function validateTrade(value: unknown, index: number, ids: Set<string>, fundIds: Set<string>, errors: string[]): value is Trade {
  const label = '交易[' + (index + 1) + ']';
  if (!isRecord(value)) { errors.push(label + '不是对象'); return false; }
  let valid = true;
  if (typeof value.id !== 'string' || !value.id.trim()) { errors.push(label + '缺少有效 ID'); valid = false; }
  else if (ids.has(value.id)) { errors.push(label + 'ID 重复：' + value.id); valid = false; }
  else ids.add(value.id);
  if (typeof value.fundId !== 'string' || !fundIds.has(value.fundId)) { errors.push(label + '引用了不存在的基金'); valid = false; }
  if (value.side !== 'BUY' && value.side !== 'SELL') { errors.push(label + '买卖方向无效'); valid = false; }
  if (!isValidTimestamp(value.tradedAt)) { errors.push(label + '成交时间无效'); valid = false; }
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)) { errors.push(label + '创建/更新时间无效'); valid = false; }
  if (typeof value.feesChecked !== 'boolean') { errors.push(label + '费用核对状态无效'); valid = false; }
  if (typeof value.note !== 'string') { errors.push(label + '备注必须是字符串'); valid = false; }
  if (!isPositiveDecimal(value.price)) { errors.push(label + '成交价格必须大于零'); valid = false; }
  try { if (typeof value.quantity !== 'string' || parseQuantity(value.quantity) <= 0n) { errors.push(label + '成交数量必须大于零'); valid = false; } }
  catch { errors.push(label + '成交数量格式无效'); valid = false; }
  for (const field of ['commission', 'transferFee', 'stampDuty', 'otherFee'] as const) {
    try {
      if (typeof value[field] !== 'string' || parseMoneyCents(value[field]) < 0n) { errors.push(label + field + '不能为负数且必须是有效金额'); valid = false; }
    } catch { errors.push(label + field + '金额格式无效'); valid = false; }
  }
  return valid;
}

function validateSnapshot(value: unknown, index: number, ids: Set<string>, fundIds: Set<string>, errors: string[]): value is PriceSnapshot {
  const label = '快照[' + (index + 1) + ']';
  if (!isRecord(value)) { errors.push(label + '不是对象'); return false; }
  let valid = true;
  if (typeof value.id !== 'string' || !value.id.trim()) { errors.push(label + '缺少有效 ID'); valid = false; }
  else if (ids.has(value.id)) { errors.push(label + 'ID 重复：' + value.id); valid = false; }
  else ids.add(value.id);
  if (typeof value.fundId !== 'string' || !fundIds.has(value.fundId)) { errors.push(label + '引用了不存在的基金'); valid = false; }
  if (!isValidTimestamp(value.createdAt)) { errors.push(label + '创建时间无效'); valid = false; }
  if (!isValidCalendarDate(value.tradingDate)) { errors.push(label + '交易日期无效'); valid = false; }
  if (!isPositiveDecimal(value.tickSize)) { errors.push(label + '最小价格变动单位必须大于零'); valid = false; }
  if (typeof value.note !== 'string') { errors.push(label + '备注必须是字符串'); valid = false; }
  if (!validatePrices(value.prices, label + '价格', errors)) valid = false;
  return valid;
}

/** Validate an untrusted backup completely before any current-device state is replaced. */
export function validateAppData(value: unknown): BackupValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['备份根节点必须是 JSON 对象'] };
  if (value.schemaVersion !== 1) errors.push('备份版本不受支持（仅接受 schemaVersion=1）');
  if (!Array.isArray(value.funds)) errors.push('funds 必须是数组');
  if (!Array.isArray(value.trades)) errors.push('trades 必须是数组');
  if (!Array.isArray(value.snapshots)) errors.push('snapshots 必须是数组');
  if (errors.length) return { valid: false, errors };

  const fundIds = new Set<string>();
  const tradeIds = new Set<string>();
  const snapshotIds = new Set<string>();
  let allFundsValid = true;
  let allTradesValid = true;
  let allSnapshotsValid = true;
  value.funds.forEach((item, index) => { if (!validateFund(item, index, fundIds, errors)) allFundsValid = false; });
  value.trades.forEach((item, index) => { if (!validateTrade(item, index, tradeIds, fundIds, errors)) allTradesValid = false; });
  value.snapshots.forEach((item, index) => { if (!validateSnapshot(item, index, snapshotIds, fundIds, errors)) allSnapshotsValid = false; });

  if (allFundsValid && allTradesValid) {
    for (const fund of value.funds as Fund[]) {
      const position = calculatePosition(value.trades as Trade[], fund.id);
      if (position.error) errors.push('基金“' + fund.name + '”的交易时序/持仓不成立：' + position.error);
    }
  }
  if (errors.length || !allFundsValid || !allTradesValid || !allSnapshotsValid) {
    return { valid: false, errors: errors.length ? errors : ['备份数据校验失败'] };
  }
  return { valid: true, data: value as unknown as AppData, errors: [] };
}
