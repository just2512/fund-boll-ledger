import { describe, expect, it } from 'vitest';
import { calculateTechnicalStateSnapshot, describeTechnicalMultiTimeframeState, describeTechnicalStateSnapshot } from './engine';
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
    const weekly = { ...base, interval: 'weekly' as const, macd: { ...base.macd, interval: 'weekly' as const, crossEvent: 'golden' as const } };
    const daily = { ...base, interval: 'daily' as const, macd: { ...base.macd, interval: 'daily' as const } };
    const description = describeTechnicalMultiTimeframeState({ monthly, weekly, daily });
    expect(description.summary).toContain('BOLL 有效 3/3 周期，MACD 稳定可用 3/3 周期');
    expect(description.summary).toContain('BOLL 带宽阶段：月线 未知');
    expect(description.summary).toContain('周线 新金叉');
    expect(description.summary).toContain('各周期独立描述，不合成为买卖方向');
    expect(description.detail).toContain('月线');
    expect(description.detail).toContain('周线');
    expect(description.detail).toContain('日线');
    expect(description.detail).toContain('不构成买卖方向或交易指令');
  });

});
