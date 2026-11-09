import { describe, expect, it } from 'vitest';
import { calculateTechnicalStateSnapshot } from './engine';
import { compareBatchWithReplay, hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import type { ConfirmedTechnicalSeries, TechnicalBar } from './types';

function series(source: '东方财富' | '百度行情' = '东方财富', count = 100): ConfirmedTechnicalSeries {
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
    expect(state.confirmedBarCount).toBe(100);
    expect(state.excludedInProgressBar).toBe(false);
    expect(state.macd.barsUsed).toBe(100);
    expect(state.validity).toBe('VALID');
    expect(state.boll.middleDirection).toBe('unknown');
    expect(state.boll.bandwidthPhase).toBe('unknown');
    expect(state.boll.bandwidthPercent).toBeDefined();
  });

  it('does not let a K-line provider switch create or erase a MACD event', () => {
    const input = series();
    const entries = replayConfirmedTechnicalSeries(input, (prefix) => calculateTechnicalStateSnapshot(prefix));
    const cross = entries.find((entry) => entry.result.macd.crossEvent === 'golden' || entry.result.macd.crossEvent === 'death');
    expect(cross).toBeDefined();
    if (!cross) return;
    const eastmoney = calculateTechnicalStateSnapshot(cross.series, undefined, '东方财富');
    const baidu = calculateTechnicalStateSnapshot({ ...cross.series, source: '百度行情' }, undefined, '东方财富');
    expect(eastmoney.macd.crossEvent).toBe(baidu.macd.crossEvent);
    expect(eastmoney.macd.dif).toBeCloseTo(baidu.macd.dif!, 12);
    expect(eastmoney.macd.dea).toBeCloseTo(baidu.macd.dea!, 12);
    expect(eastmoney.boll.bandwidthPercent).toBeCloseTo(baidu.boll.bandwidthPercent!, 12);
    expect(eastmoney.source).not.toBe(baidu.source);
  });

  it('replays BOLL and MACD together without future bars and matches batch output', () => {
    const input = series();
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const entries = replayConfirmedTechnicalSeries(input, calculate);
    expect(hasNoFutureBars(entries)).toBe(true);
    const comparison = compareBatchWithReplay(input, calculate);
    expect(comparison?.matches).toBe(true);
    const events = entries.filter((entry) => entry.result.macd.crossEvent === 'golden' || entry.result.macd.crossEvent === 'death');
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(1);
    for (const event of events) {
      const later = entries.filter((entry) => entry.asOfDate > event.asOfDate);
      expect(later.every((entry) => entry.result.macd.crossEvent === 'none')).toBe(true);
    }
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
    const original = series('东方财富', 80);
    const extended = series('东方财富', 100);
    const calculate = (prefix: ConfirmedTechnicalSeries) => calculateTechnicalStateSnapshot(prefix);
    const before = replayConfirmedTechnicalSeries(original, calculate);
    const after = replayConfirmedTechnicalSeries(extended, calculate);
    expect(after.slice(0, before.length).map((entry) => entry.result))
      .toEqual(before.map((entry) => entry.result));
  });
});
