import { describe, expect, it } from 'vitest';
import { calculateMacdFromConfirmedSeries, calculateMacdPeriod, macdArrangementLabel, macdMomentumLabel, macdZeroAxisLabel, summarizeMacdPeriods, unavailableMacdPeriod, type MacdBar } from './macd';
import type { ConfirmedTechnicalSeries } from './technical-state/types';

function barsWithReversal(): MacdBar[] {
  const start = new Date('2025-01-01T00:00:00.000Z');
  return Array.from({ length: 120 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const close = index < 48 ? 30 - index * 0.22 : 30 - 48 * 0.22 + (index - 48) * 0.28;
    return { date: date.toISOString().slice(0, 10), close: close.toFixed(3) };
  });
}
function contextFor(bars: MacdBar[], time = '15:05'): { tradingDate: string; quotedAt: string } {
  const date = bars[bars.length - 1].date;
  return { tradingDate: date, quotedAt: date + ' ' + time + ':00（北京时间）' };
}
describe('MACD deterministic multi-timeframe rules', () => {
  it('requires enough closed bars instead of inventing a status', () => {
    const shortBars = barsWithReversal().slice(0, 30);
    const state = calculateMacdPeriod(shortBars, 'daily', contextFor(shortBars));
    expect(state.error).toContain('不足');
    expect(state.availability).toBe('insufficient-history');
    expect(macdArrangementLabel(state)).toBe('历史不足');
  });
  it('excludes the active intraday candle for cross confirmation', () => {
    const source = barsWithReversal();
    const state = calculateMacdPeriod(source, 'daily', contextFor(source, '11:30'));
    expect(state.error).toBeUndefined();
    expect(state.asOfDate).toBe(source[source.length - 2].date);
  });
  it('includes the current interval bar only when source time confirms its close', () => {
    const source = barsWithReversal();
    const state = calculateMacdPeriod(source, 'daily', contextFor(source, '15:05'));
    expect(state.asOfDate).toBe(source[source.length - 1].date);
  });
  it('excludes the in-progress weekly bar even after intraweek 15:00', () => {
    // Weekly candles close with the week itself; an intraweek 15:05 stamp must NOT confirm it.
    const mondays = Array.from({ length: 60 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 6)); // a Monday
      date.setUTCDate(date.getUTCDate() + index * 7);
      const close = index < 48 ? 30 - index * 0.22 : 30 - 48 * 0.22 + (index - 48) * 0.28;
      return { date: date.toISOString().slice(0, 10), close: close.toFixed(3) };
    });
    const lastBar = mondays[mondays.length - 1];
    const wednesdaySameWeek = new Date(lastBar.date + 'T00:00:00.000Z');
    wednesdaySameWeek.setUTCDate(wednesdaySameWeek.getUTCDate() + 2); // Wed of the last bar's week
    const wednesdayIso = wednesdaySameWeek.toISOString().slice(0, 10);
    const state = calculateMacdPeriod(mondays, 'weekly', { tradingDate: wednesdayIso, quotedAt: wednesdayIso + ' 15:05:00（北京时间）' });
    // The quote shares the last bar's week: the bar is in progress and must be excluded.
    expect(state.asOfDate).toBe(mondays[mondays.length - 2].date);
    // A quote dated after the last bar's week confirms it: the last bar stays.
    const mondayAfter = new Date(lastBar.date + 'T00:00:00.000Z');
    mondayAfter.setUTCDate(mondayAfter.getUTCDate() + 7);
    const afterWeek = calculateMacdPeriod(mondays, 'weekly', { tradingDate: mondayAfter.toISOString().slice(0, 10) });
    expect(afterWeek.asOfDate).toBe(lastBar.date);
  });
  it('distinguishes a new cross from an existing persistent arrangement', () => {
    const source = barsWithReversal();
    const state = calculateMacdPeriod(source, 'daily', contextFor(source));
    expect(state.error).toBeUndefined();
    expect(state.crossEvent).toBe('none');
    expect(['bull-after-golden', 'bear-after-death']).toContain(state.arrangement);
    expect(['golden', 'death']).toContain(state.lastCross);
  });
  it('returns explicit unknown status when the data source is unavailable', () => {
    const monthly = unavailableMacdPeriod('monthly', 'fixture error');
    const weekly = unavailableMacdPeriod('weekly', 'fixture error');
    const daily = unavailableMacdPeriod('daily', 'fixture error');
    const result = summarizeMacdPeriods({ monthly, weekly, daily });
    expect(result.summary).toBe('MACD 数据不完整');
    expect(monthly.availability).toBe('unavailable');
    expect(macdZeroAxisLabel(monthly)).toBe('数据不可用');
    expect(macdMomentumLabel(daily)).toBe('数据不可用');
  });
  it('exposes the existing calculation through a confirmed-series entry point and records EMA seed metadata', () => {
    const source = barsWithReversal();
    const confirmed: ConfirmedTechnicalSeries = {
      interval: 'daily',
      asOfDate: source[source.length - 1].date,
      bars: source.map((bar) => ({ date: bar.date, close: Number(bar.close) })),
      excludedInProgressBar: false,
      source: '东方财富',
    };
    const direct = calculateMacdFromConfirmedSeries(confirmed);
    const wrapped = calculateMacdPeriod(source, 'daily', contextFor(source));
    expect(direct.error).toBeUndefined();
    expect(direct.asOfDate).toBe(confirmed.asOfDate);
    expect(direct.dif).toBeCloseTo(wrapped.dif!, 12);
    expect(direct.dea).toBeCloseTo(wrapped.dea!, 12);
    expect(direct.barsUsed).toBe(120);
    expect(direct.emaSeedDate).toBe(source[0].date);
    expect(direct.preRollBars).toBe(85);
  });

  it('rejects conflicting duplicate dates instead of silently choosing the last row', () => {
    const source = barsWithReversal();
    const conflict = [...source, { ...source[source.length - 1], close: '99.999' }];
    const state = calculateMacdPeriod(conflict, 'daily', contextFor(source));
    expect(state.error).toContain('冲突收盘价');
  });

  it('describes the legacy multi-timeframe summary as DIF zero-axis position, not a full bullish/bearish verdict', () => {
    const source = barsWithReversal();
    const base = calculateMacdPeriod(source, 'daily', contextFor(source));
    const summary = summarizeMacdPeriods({
      monthly: { ...base, interval: 'monthly', zeroAxis: 'above' },
      weekly: { ...base, interval: 'weekly', zeroAxis: 'above' },
      daily: { ...base, interval: 'daily', zeroAxis: 'above' },
    });
    expect(summary.summary).toBe('三周期 DIF 位于零轴上方');
    expect(summary.summary).not.toBe('三周期偏多');
    expect(summary.summaryTone).toBe('neutral');
  });

  it('rejects malformed dates and non-positive closes in legacy MACD input', () => {
    const source = barsWithReversal();
    const badDate = [...source];
    badDate[5] = { ...badDate[5], date: 'not-a-date' };
    const badClose = [...source];
    badClose[5] = { ...badClose[5], close: '0' };
    const invalidDateState = calculateMacdPeriod(badDate, 'daily', contextFor(source));
    const invalidCloseState = calculateMacdPeriod(badClose, 'daily', contextFor(source));
    expect(invalidDateState.error).toContain('日期');
    expect(invalidDateState.availability).toBe('invalid-data');
    expect(invalidDateState.crossEvent).toBe('unknown');
    expect(invalidCloseState.error).toContain('收盘价');
    expect(invalidCloseState.availability).toBe('invalid-data');
    expect(invalidCloseState.crossEvent).toBe('unknown');
  });

});
