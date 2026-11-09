import { describe, expect, it } from 'vitest';
import { normalizeConfirmedTechnicalSeries } from './series';
import { compareBatchWithReplay, hasNoFutureBars, replayConfirmedTechnicalSeries } from './history-replay';
import type { ConfirmedTechnicalSeries, TechnicalRawBar } from './types';

function dailyBars(count: number, start = '2026-01-01'): TechnicalRawBar[] {
  const first = new Date(start + 'T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), close: (10 + index / 100).toFixed(3) };
  });
}

describe('normalizeConfirmedTechnicalSeries', () => {
  it('sorts dates and collapses identical duplicate bars', () => {
    const bars = dailyBars(40);
    const result = normalizeConfirmedTechnicalSeries({
      interval: 'daily',
      bars: [bars[2], bars[0], bars[1], bars[1], ...bars.slice(3)],
      source: '百度行情',
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 15:00:00（北京时间）' },
    });
    expect(result.validity).toBe('VALID');
    if (result.validity !== 'VALID') return;
    expect(result.series.bars).toHaveLength(40);
    expect(result.series.bars[0].date).toBe(bars[0].date);
    expect(result.series.source).toBe('百度行情');
  });

  it('rejects conflicting duplicate closes rather than silently using the last row', () => {
    const bars = dailyBars(40);
    const result = normalizeConfirmedTechnicalSeries({
      interval: 'daily',
      bars: [...bars, { ...bars[39], close: '99.000' }],
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 15:00:00（北京时间）' },
    });
    expect(result.validity).toBe('INVALID');
    if (result.validity !== 'VALID') expect(result.reason).toContain('冲突收盘价');
  });

  it('rejects malformed dates and non-positive prices with diagnostic reasons', () => {
    const bars = dailyBars(40);
    const badDate = normalizeConfirmedTechnicalSeries({
      interval: 'daily',
      bars: [{ ...bars[0], date: '2026-02-30' }],
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 15:00:00' },
    });
    const badClose = normalizeConfirmedTechnicalSeries({
      interval: 'daily',
      bars: [{ ...bars[0], close: '0' }],
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 15:00:00' },
    });
    expect(badDate.validity).toBe('INVALID');
    expect(badClose.validity).toBe('INVALID');
  });

  it('fails closed when the source trading date is missing', () => {
    const bars = dailyBars(40);
    const result = normalizeConfirmedTechnicalSeries({ interval: 'daily', bars, quote: {} });
    expect(result.validity).toBe('INVALID');
  });

  it('excludes the active daily candle before 15:00 and includes it at 15:00 source time', () => {
    const bars = dailyBars(40);
    const before = normalizeConfirmedTechnicalSeries({
      interval: 'daily', bars,
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 14:59:59（北京时间）' },
    });
    const after = normalizeConfirmedTechnicalSeries({
      interval: 'daily', bars,
      quote: { tradingDate: bars[39].date, quotedAt: bars[39].date + ' 15:00:00（北京时间）' },
    });
    expect(before.validity).toBe('VALID');
    expect(after.validity).toBe('VALID');
    if (before.validity === 'VALID' && after.validity === 'VALID') {
      expect(before.series.asOfDate).toBe(bars[38].date);
      expect(before.series.excludedInProgressBar).toBe(true);
      expect(after.series.asOfDate).toBe(bars[39].date);
      expect(after.series.excludedInProgressBar).toBe(false);
    }
  });

  it('excludes an in-progress weekly bar even after Wednesday 15:00', () => {
    const bars = Array.from({ length: 40 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 6 + index * 7));
      return { date: date.toISOString().slice(0, 10), close: 10 + index / 100 };
    });
    const lastDate = new Date(bars[39].date + 'T00:00:00.000Z');
    lastDate.setUTCDate(lastDate.getUTCDate() + 2);
    const wednesday = lastDate.toISOString().slice(0, 10);
    const result = normalizeConfirmedTechnicalSeries({
      interval: 'weekly', bars,
      quote: { tradingDate: wednesday, quotedAt: wednesday + ' 15:00:00（北京时间）' },
    });
    expect(result.validity).toBe('VALID');
    if (result.validity === 'VALID') {
      expect(result.series.asOfDate).toBe(bars[38].date);
      expect(result.series.excludedInProgressBar).toBe(true);
    }
  });

  it('includes the last weekly bar only after the quote date enters the next week', () => {
    const bars = Array.from({ length: 40 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 6 + index * 7));
      return { date: date.toISOString().slice(0, 10), close: 10 + index / 100 };
    });
    const nextWeek = new Date(bars[39].date + 'T00:00:00.000Z');
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const quoteDate = nextWeek.toISOString().slice(0, 10);
    const result = normalizeConfirmedTechnicalSeries({ interval: 'weekly', bars, quote: { tradingDate: quoteDate } });
    expect(result.validity).toBe('VALID');
    if (result.validity === 'VALID') expect(result.series.asOfDate).toBe(bars[39].date);
  });
  it('excludes the in-progress monthly candle until the quote moves into the next month', () => {
    const bars = Array.from({ length: 20 }, (_, index) => {
      const date = new Date(Date.UTC(2025, index, 1));
      return { date: date.toISOString().slice(0, 10), close: 10 + index / 100 };
    });
    const currentMonthDate = '2026-08-15';
    const inMonth = normalizeConfirmedTechnicalSeries({
      interval: 'monthly', bars,
      quote: { tradingDate: currentMonthDate, quotedAt: currentMonthDate + ' 15:00:00（北京时间）' },
    });
    const nextMonth = normalizeConfirmedTechnicalSeries({
      interval: 'monthly', bars,
      quote: { tradingDate: '2026-09-01' },
    });
    expect(inMonth.validity).toBe('VALID');
    expect(nextMonth.validity).toBe('VALID');
    if (inMonth.validity === 'VALID' && nextMonth.validity === 'VALID') {
      expect(inMonth.series.asOfDate).toBe(bars[18].date);
      expect(inMonth.series.excludedInProgressBar).toBe(true);
      expect(nextMonth.series.asOfDate).toBe(bars[19].date);
    }
  });

});

describe('confirmed history replay', () => {
  function confirmedSeries(): ConfirmedTechnicalSeries {
    const bars = dailyBars(50).map((bar) => ({ date: bar.date, close: Number(bar.close) }));
    return { interval: 'daily', asOfDate: bars[49].date, bars, excludedInProgressBar: false };
  }

  it('only passes an as-of prefix to each replay callback', () => {
    const input = confirmedSeries();
    const entries = replayConfirmedTechnicalSeries(input, (prefix) => prefix.bars.map((bar) => bar.date));
    expect(entries).toHaveLength(50);
    expect(hasNoFutureBars(entries)).toBe(true);
    expect(entries[0].confirmedBarCount).toBe(1);
    expect(entries[49].confirmedBarCount).toBe(50);
    expect(entries[10].result).toHaveLength(11);
  });

  it('does not mutate the original series while replaying', () => {
    const input = confirmedSeries();
    const before = input.bars.map((bar) => bar.date);
    replayConfirmedTechnicalSeries(input, (prefix) => prefix.bars.length);
    expect(input.bars.map((bar) => bar.date)).toEqual(before);
  });

  it('matches batch calculation with the last same-start replay result', () => {
    const input = confirmedSeries();
    const calculate = (series: ConfirmedTechnicalSeries) => ({
      count: series.bars.length,
      asOfDate: series.asOfDate,
      lastClose: series.bars.at(-1)?.close,
    });
    const result = compareBatchWithReplay(input, calculate);
    expect(result?.matches).toBe(true);
  });

  it('keeps all earlier replay results unchanged when future bars are appended', () => {
    const original = confirmedSeries();
    const appendedBars = [...original.bars, ...dailyBars(5, '2026-02-20').map((bar) => ({ date: bar.date, close: Number(bar.close) }))];
    const extended: ConfirmedTechnicalSeries = {
      ...original,
      asOfDate: appendedBars[appendedBars.length - 1].date,
      bars: appendedBars,
    };
    const calculate = (series: ConfirmedTechnicalSeries) => ({
      count: series.bars.length,
      asOfDate: series.asOfDate,
      close: series.bars.at(-1)?.close,
    });
    const before = replayConfirmedTechnicalSeries(original, calculate);
    const after = replayConfirmedTechnicalSeries(extended, calculate);
    expect(after.slice(0, before.length).map((entry) => entry.result)).toEqual(before.map((entry) => entry.result));
  });
});
