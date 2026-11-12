import { describe, expect, it } from 'vitest';
import { calculateTechnicalStateSnapshot, describeTechnicalMultiTimeframeState, describeTechnicalStateSnapshot, unavailableTechnicalState } from './engine';
import { compareBatchWithReplay, hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import { bollStateConfigFor } from './config';
import type { ConfirmedTechnicalSeries, TechnicalBar } from './types';

function series(source: '东方财富' | '百度行情' = '东方财富', count = 220): ConfirmedTechnicalSeries {
  const first = new Date('2025-01-01T00:00:00.000Z');
  const bars: TechnicalBar[] = Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    const close = index < 45 ? 30 - index * 0.25 : 18.75 + (index - 45) * 0.32;
    return { date: date.toISOString().slice(0, 10), close };
  });
  return {
    interval: 'daily',
    asOfDate: bars[bars.length - 1].date,
    bars,
    source,
    excludedInProgressBar: false,
  };
}

describe('combined BOLL/MACD technical state engine', () => {
  it('uses one confirmed prefix and exposes its actual source and loaded coverage', () => {
    const input = series();
    const state = calculateTechnicalStateSnapshot(input, undefined, '百度行情');
    expect(state.asOfDate).toBe(input.asOfDate);
    expect(state.boll.asOfDate).toBe(input.asOfDate);
    expect(state.macd.asOfDate).toBe(input.asOfDate);
    expect(state.source).toBe('东方财富');
    expect(state.quoteSource).toBe('百度行情');
    expect(state.historyStartDate).toBe(input.bars[0].date);
    expect(state.confirmedBarCount).toBe(220);
    expect(state.excludedInProgressBar).toBe(false);
    expect(state.macd.barsUsed).toBe(220);
    expect(state.validity).toBe('VALID');
    expect(state.boll.middleDirection).toBe('unknown');
    expect(state.boll.bandwidthPhase).toBe('unknown');
    expect(state.boll.bandwidthPercent).toBeDefined();
  });

  it('applies the empirically evaluated interval configuration to BOLL state labels', () => {
    const snapshot = calculateTechnicalStateSnapshot(series(), bollStateConfigFor('daily'));
    expect(snapshot.boll.validity).toBe('VALID');
    expect(snapshot.boll.bandwidthPercentile).toBeDefined();
    expect(snapshot.boll.bandwidthPhase).not.toBe('unknown');
    expect(snapshot.boll.middleDirection).not.toBe('unknown');
    expect(snapshot.boll.reason).toBeUndefined();
  });

  it('does not let a K-line provider switch alter confirmed BOLL or MACD state', () => {
    const input = series();
    const eastmoney = calculateTechnicalStateSnapshot(input, undefined, '东方财富');
    const baidu = calculateTechnicalStateSnapshot({ ...input, source: '百度行情' }, undefined, '东方财富');
    expect(eastmoney.macd).toEqual(baidu.macd);
    expect(eastmoney.boll).toEqual(baidu.boll);
    expect(eastmoney.source).not.toBe(baidu.source);
  });

  it('replays BOLL and MACD together without future bars and matches batch output', () => {
    const input = series();
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const entries = replayConfirmedTechnicalSeries(input, calculate);
    expect(hasNoFutureBars(entries)).toBe(true);
    const comparison = compareBatchWithReplay(input, calculate);
    expect(comparison?.matches).toBe(true);
    expect(entries.slice(0, 159).every((entry) => entry.result.macd.availability === 'insufficient-history')).toBe(true);
    expect(entries.slice(159).every((entry) => entry.result.macd.availability === 'ready')).toBe(true);
    expect(entries.at(-1)?.result.macd.crossEvent).toBe('none');
    expect(['golden', 'death']).toContain(entries.at(-1)?.result.macd.lastCross);
  });

  it('preserves excluded in-progress bar metadata on the final replay prefix', () => {
    const input = { ...series(), excludedInProgressBar: true };
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const replay = replayConfirmedTechnicalSeries(input, calculate);
    expect(replay.at(-1)?.series.excludedInProgressBar).toBe(true);
    expect(replay.slice(0, -1).every((entry) => !entry.series.excludedInProgressBar)).toBe(true);
    expect(compareBatchWithReplay(input, calculate)?.matches).toBe(true);
  });

  it('keeps earlier combined indicator results unchanged when future bars are appended', () => {
    const original = series('东方财富', 180);
    const extended = series('东方财富', 220);
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const before = replayConfirmedTechnicalSeries(original, calculate);
    const after = replayConfirmedTechnicalSeries(extended, calculate);
    expect(after.slice(0, before.length).map((entry) => entry.result))
      .toEqual(before.map((entry) => entry.result));
  });

  it('describes each indicator from its structured fields without inventing a composite trading direction', () => {
    const snapshot = calculateTechnicalStateSnapshot(series());
    const description = describeTechnicalStateSnapshot(snapshot);
    expect(description).toContain('日线');
    expect(description).toContain('BOLL(20,2)');
    expect(description).toContain('带宽阶段 未知');
    expect(description).toContain('中轨方向 未知');
    expect(description).toContain('MACD(12,26,9)');
    expect(description).toContain('DIF/DEA');
    expect(description).toContain('不构成买卖方向或交易指令');
    expect(description).toContain('状态阈值未配置');
  });

  it('summarizes BOLL and MACD independently across month, week and day without a composite trade direction', () => {
    const base = calculateTechnicalStateSnapshot(series());
    const monthly = { ...base, interval: 'monthly' as const, macd: { ...base.macd, interval: 'monthly' as const } };
    const weekly = { ...base, interval: 'weekly' as const, macd: { ...base.macd, interval: 'weekly' as const, crossEvent: 'golden' as const, arrangement: 'new-golden' as const } };
    const daily = { ...base, interval: 'daily' as const, macd: { ...base.macd, interval: 'daily' as const } };
    const description = describeTechnicalMultiTimeframeState({ monthly, weekly, daily });
    expect(description.summary).toContain('日线：BOLL');
    expect(description.summary).toContain('周线：BOLL');
    expect(description.summary).toContain('月线：BOLL');
    expect(description.summary).toContain('周线：BOLL');
    expect(description.summary).toContain('新金叉');
    expect(description.summary).not.toContain('BOLL 有效 3/3');
    expect(description.summary).not.toContain('MACD 稳定可用 3/3');
    expect(description.summary).not.toContain('无新交叉');
    expect(description.detail).toContain('月线');
    expect(description.detail).toContain('周线');
    expect(description.detail).toContain('日线');
    expect(description.detail).toContain('不构成买卖方向或交易指令');
  });

  it('reports BOLL and MACD validity independently when one indicator lacks sufficient history', () => {
    const short = calculateTechnicalStateSnapshot(series('东方财富', 100));
    const full = calculateTechnicalStateSnapshot(series());
    const periods = {
      daily: short,
      weekly: { ...full, interval: 'weekly' as const, macd: { ...full.macd, interval: 'weekly' as const } },
      monthly: { ...full, interval: 'monthly' as const, macd: { ...full.macd, interval: 'monthly' as const } },
    };
    const summary = describeTechnicalMultiTimeframeState(periods).summary;
    expect(summary).toContain('日线：BOLL');
    expect(summary).toContain('MACD 历史不足');
    expect(summary).toContain('周线：BOLL');
    expect(summary).not.toContain('BOLL 有效');
  });

  it('keeps insufficient, unavailable and invalid MACD detail descriptions distinct', () => {
    const insufficient = calculateTechnicalStateSnapshot(series('东方财富', 100));
    const insufficientDetail = describeTechnicalStateSnapshot(insufficient);
    expect(insufficientDetail).toContain('MACD 历史不足');
    expect(insufficientDetail).not.toContain('MACD 数据不可用');

    const unavailable = unavailableTechnicalState('daily', 'UNAVAILABLE', '缺少可信行情日期');
    expect(describeTechnicalStateSnapshot(unavailable)).toContain('MACD 数据不可用：缺少可信行情日期');

    const invalid = unavailableTechnicalState('daily', 'INVALID', '收盘价无效');
    expect(describeTechnicalStateSnapshot(invalid)).toContain('MACD 数据无效：收盘价无效');
  });

  it('does not turn unavailable MACD data into a neutral or no-cross state', () => {
    const full = calculateTechnicalStateSnapshot(series());
    const unavailable = {
      ...full,
      interval: 'monthly' as const,
      macd: {
        ...full.macd,
        interval: 'monthly' as const,
        availability: 'unavailable' as const,
        error: '缺少可信行情日期',
        crossEvent: 'unknown' as const,
      },
    };
    const summary = describeTechnicalMultiTimeframeState({
      daily: full,
      weekly: { ...full, interval: 'weekly' as const, macd: { ...full.macd, interval: 'weekly' as const } },
      monthly: unavailable,
    }).summary;
    expect(summary).toContain('月线：BOLL');
    expect(summary).toContain('MACD 数据不可用：缺少可信行情日期');
  });

  it('keeps MACD formula history available below the stable-state publication gate', () => {
    const snapshot = calculateTechnicalStateSnapshot(series('东方财富', 100));
    expect(snapshot.macd.availability).toBe('insufficient-history');
    expect(snapshot.macdHistory).toHaveLength(100);
    expect(snapshot.macdHistory.at(-1)?.formulaReady).toBe(true);
    expect(snapshot.macdHistory.at(-1)?.dif).toBeDefined();
  });

  it('keeps BOLL and MACD history rows aligned to the same confirmed dates', () => {
    const input = series();
    const snapshot = calculateTechnicalStateSnapshot(input, bollStateConfigFor('daily'));
    expect(snapshot.bollHistory).toHaveLength(input.bars.length);
    expect(snapshot.macdHistory).toHaveLength(input.bars.length);
    expect(snapshot.bollHistory.map((point) => point.date)).toEqual(input.bars.map((bar) => bar.date));
    expect(snapshot.macdHistory.map((point) => point.date)).toEqual(input.bars.map((bar) => bar.date));
  });

  it('distinguishes unavailable source data from invalid indicator input', () => {
    const snapshot = unavailableTechnicalState('daily', 'UNAVAILABLE', '缺少可信交易日期');
    expect(snapshot.validity).toBe('UNAVAILABLE');
    expect(snapshot.boll.validity).toBe('UNAVAILABLE');
    expect(snapshot.macd.availability).toBe('unavailable');
    const summary = describeTechnicalMultiTimeframeState({
      daily: snapshot,
      weekly: calculateTechnicalStateSnapshot(series()),
      monthly: calculateTechnicalStateSnapshot(series()),
    }).summary;
    expect(summary).toContain('日线：BOLL 数据不可用');
    expect(summary).toContain('MACD 数据不可用');
  });

});
