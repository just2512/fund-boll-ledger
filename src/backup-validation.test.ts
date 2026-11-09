import { describe, expect, it } from 'vitest';
import { validateAppData } from './backup-validation';
import { emptyAppData, newFund, type AppData, type Trade } from './types';

function validBackup(): AppData {
  const fund = { ...newFund('沪深300 ETF'), id: 'fund-1', code: '510300' };
  const trade: Trade = {
    id: 'trade-1', fundId: fund.id, tradedAt: '2026-11-06T09:30',
    side: 'BUY', price: '4.000', quantity: '100', commission: '0.60',
    transferFee: '0', stampDuty: '0', otherFee: '0.16', feesChecked: false,
    note: '', createdAt: '2026-11-06T01:31:00.000Z', updatedAt: '2026-11-06T01:31:00.000Z',
  };
  return { ...emptyAppData(), funds: [fund], trades: [trade] };
}

describe('backup validation', () => {
  it('accepts a complete valid backup', () => {
    const result = validateAppData(validBackup());
    expect(result.valid).toBe(true);
  });

  it('rejects unsupported schema and non-object roots', () => {
    expect(validateAppData(null)).toMatchObject({ valid: false });
    expect(validateAppData({ ...validBackup(), schemaVersion: 2 })).toMatchObject({ valid: false });
  });

  it('rejects duplicate IDs and dangling fund references', () => {
    const backup = validBackup();
    backup.trades.push({ ...backup.trades[0], fundId: 'missing-fund' });
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/引用了不存在的基金/);
  });

  it('rejects duplicate IDs within each entity collection', () => {
    const backup = validBackup();
    backup.trades.push({ ...backup.trades[0], id: backup.trades[0].id });
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/ID 重复/);
  });

  it('rejects invalid enum values, malformed timestamps and invalid prices', () => {
    const backup = validBackup();
    backup.funds[0].market = 'UNKNOWN' as AppData['funds'][number]['market'];
    backup.funds[0].prices.upper = '-1';
    backup.trades[0].createdAt = 'not-a-date';
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.join(' ')).toMatch(/交易市场值无效/);
      expect(result.errors.join(' ')).toMatch(/必须为空或大于零的有效价格/);
      expect(result.errors.join(' ')).toMatch(/创建\/更新时间无效/);
    }
  });

  it('rejects sells that exceed the historical position at the trade time', () => {
    const backup = validBackup();
    backup.trades[0] = { ...backup.trades[0], side: 'SELL', quantity: '101' };
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/交易时序\/持仓不成立/);
  });

  it('rejects impossible calendar dates in snapshots', () => {
    const backup = validBackup();
    backup.snapshots.push({
      id: 'snapshot-1', fundId: backup.funds[0].id, createdAt: '2026-11-06T02:00:00.000Z',
      tradingDate: '2026-02-30', prices: { ...backup.funds[0].prices }, tickSize: '0.001', note: '',
    });
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/交易日期无效/);
  });

  it('rejects invalid fee amounts and non-positive quantities', () => {
    const backup = validBackup();
    backup.trades[0].commission = '-0.01';
    backup.trades[0].quantity = '0';
    const result = validateAppData(backup);
    expect(result.valid).toBe(false);
  });
});
